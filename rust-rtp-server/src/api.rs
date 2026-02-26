use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

use crate::audio::aec::UserSpeakingEvent;
use crate::audio::codec::AudioCodec;
use crate::config::Config;
use crate::session::{SessionInfo, SessionManager};
use crate::transcription::TranscriptionEvent;
use crate::tts::{TtsCommand, TtsPlaybackEvent};

/// Shared application state
pub struct AppState {
    pub session_manager: Arc<SessionManager>,
    pub transcription_tx: broadcast::Sender<TranscriptionEvent>,
    pub tts_event_tx: broadcast::Sender<TtsPlaybackEvent>,
    /// Broadcasts user_speaking events from AEC energy detection
    pub speech_event_tx: broadcast::Sender<UserSpeakingEvent>,
    /// UDP socket for RTP (bidirectional: mic IN + TTS OUT on same ExternalMedia channel)
    pub rtp_socket: Arc<tokio::net::UdpSocket>,
    /// UDP socket for TTS auto-detection on port 8001 (backward compat)
    pub tts_udp_socket: Arc<tokio::net::UdpSocket>,
    pub config: Config,
}

/// Start the HTTP/WebSocket API server
pub async fn serve(state: Arc<AppState>) -> anyhow::Result<()> {
    let app = Router::new()
        .route("/health", get(health))
        .route("/sessions", get(list_sessions).post(create_session))
        .route("/sessions/:id", get(get_session).delete(delete_session))
        .route("/sessions/:id/configure-tts", axum::routing::post(configure_tts))
        .route("/sessions/:id/tts", axum::routing::post(tts_action))
        .route("/ws", get(ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state.clone());

    let addr = format!("0.0.0.0:{}", state.config.api_port);
    tracing::info!("API server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

async fn health(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "sessions": state.session_manager.count(),
        "rtp_listen": state.config.rtp_listen_addr,
    }))
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CreateSessionRequest {
    /// Caller-provided session ID (e.g. "call-123-abc"). Generated if omitted.
    session_id: Option<String>,
    /// Audio codec: "ulaw", "slin16", "opus"
    codec: Option<String>,
    /// Override transcription service URLs
    transcription_services: Option<Vec<String>>,
    /// Expected source address (ip:port) from Asterisk ExternalMedia
    source_addr: Option<String>,
    /// Enable AEC (Acoustic Echo Cancellation) for full-duplex TTS
    #[serde(default)]
    aec_enabled: bool,
}

async fn create_session(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateSessionRequest>,
) -> impl IntoResponse {
    let codec_str = req
        .codec
        .as_deref()
        .unwrap_or(&state.config.default_codec);
    let codec = AudioCodec::from_str(codec_str);

    let transcription_urls = req
        .transcription_services
        .unwrap_or_else(|| state.config.transcription_urls());

    if transcription_urls.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "No transcription services configured. Set TRANSCRIPTION_SERVICES env var or pass transcription_services in request."
            })),
        )
            .into_response();
    }

    let source_addr = req.source_addr.and_then(|s| s.parse().ok());

    let session_id = state.session_manager.create_session(
        req.session_id,
        codec.clone(),
        transcription_urls.clone(),
        source_addr,
        state.transcription_tx.clone(),
        state.config.buffer_flush_ms,
        req.aec_enabled,
        if req.aec_enabled { Some(state.speech_event_tx.clone()) } else { None },
    );

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "session_id": session_id,
            "codec": codec.to_string(),
            "transcription_services": transcription_urls,
            "rtp_target": state.config.rtp_listen_addr,
        })),
    )
        .into_response()
}

async fn list_sessions(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<SessionInfo>> {
    Json(state.session_manager.list_sessions())
}

async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.session_manager.get_info(&id) {
        Some(info) => (StatusCode::OK, Json(serde_json::json!(info))).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Session not found"})),
        )
            .into_response(),
    }
}

async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if state.session_manager.remove_session(&id) {
        StatusCode::NO_CONTENT.into_response()
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Session not found"})),
        )
            .into_response()
    }
}

// ---------------------------------------------------------------------------
// TTS configuration + audio injection
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ConfigureTtsRequest {
    /// Target address for TTS RTP packets (Asterisk ExternalMedia OUT's RTP address).
    /// Optional — if omitted, auto-detected from first RTP packet on port 8001.
    tts_target_addr: Option<String>,
}

async fn configure_tts(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<ConfigureTtsRequest>,
) -> impl IntoResponse {
    // Check session exists
    if state.session_manager.get(&id).is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Session not found"})),
        )
            .into_response();
    }

    // If target address is provided, configure immediately
    if let Some(addr_str) = req.tts_target_addr {
        let target_addr: std::net::SocketAddr = match addr_str.parse() {
            Ok(addr) => addr,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "Invalid tts_target_addr"})),
                )
                    .into_response();
            }
        };

        if state.session_manager.configure_tts(
            &id,
            target_addr,
            state.rtp_socket.clone(),
            state.tts_event_tx.clone(),
        ) {
            return Json(serde_json::json!({
                "status": "ok",
                "session_id": id,
                "tts_target_addr": target_addr.to_string(),
            }))
            .into_response();
        }
    }

    // No address provided — auto-detect from the session's bound RTP source on port 8000.
    // Asterisk sends mic audio to port 8000; the RTP listener detects the source address.
    // We send TTS RTP back to the same address (bidirectional ExternalMedia).

    // Check if source is already detected
    if let Some(addr) = state.session_manager.find_source_for_session(&id) {
        if state.session_manager.configure_tts(
            &id,
            addr,
            state.rtp_socket.clone(),
            state.tts_event_tx.clone(),
        ) {
            return Json(serde_json::json!({
                "status": "ok",
                "session_id": id,
                "tts_target_addr": addr.to_string(),
                "auto_detected": true,
            }))
            .into_response();
        }
    }

    // Source not yet detected — wait for first RTP packet (up to 3 seconds)
    for _ in 0..30 {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        if let Some(addr) = state.session_manager.find_source_for_session(&id) {
            if state.session_manager.configure_tts(
                &id,
                addr,
                state.rtp_socket.clone(),
                state.tts_event_tx.clone(),
            ) {
                return Json(serde_json::json!({
                    "status": "ok",
                    "session_id": id,
                    "tts_target_addr": addr.to_string(),
                    "auto_detected": true,
                }))
                .into_response();
            }
        }
    }

    // Timeout — source never detected
    tracing::warn!("Session {} TTS auto-detect timed out (no RTP on port 8000)", id);
    (
        StatusCode::REQUEST_TIMEOUT,
        Json(serde_json::json!({
            "status": "timeout",
            "session_id": id,
            "message": "No RTP source detected on port 8000 within 3 seconds",
        })),
    )
        .into_response()
}

/// TTS action endpoint. Accepts either:
/// - Binary body: raw slin16 PCM audio to play
/// - JSON body: {"action": "done", "utterance_id": "..."} or {"action": "cancel"}
async fn tts_action(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    req: axum::http::Request<axum::body::Body>,
) -> impl IntoResponse {
    let session = match state.session_manager.get(&id) {
        Some(s) => s,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Session not found"})),
            )
                .into_response();
        }
    };

    let tts_tx = match session.tts_cmd_tx.get() {
        Some(tx) => tx,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "TTS not configured for this session. Call /configure-tts first."})),
            )
                .into_response();
        }
    };

    let content_type = req
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let body_bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Failed to read body"})),
            )
                .into_response();
        }
    };

    if content_type.contains("application/json") {
        // JSON command: done or cancel
        let json: serde_json::Value = match serde_json::from_slice(&body_bytes) {
            Ok(v) => v,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "Invalid JSON"})),
                )
                    .into_response();
            }
        };

        let action = json["action"].as_str().unwrap_or("");
        match action {
            "done" => {
                let utterance_id = json["utterance_id"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                let _ = tts_tx.send(TtsCommand::Done { utterance_id }).await;
            }
            "cancel" => {
                let _ = tts_tx.send(TtsCommand::Cancel).await;
            }
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "Unknown action. Use 'done' or 'cancel'."})),
                )
                    .into_response();
            }
        }

        Json(serde_json::json!({"status": "ok"})).into_response()
    } else {
        // Binary body: raw PCM audio
        if body_bytes.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Empty audio body"})),
            )
                .into_response();
        }

        let _ = tts_tx.send(TtsCommand::Audio(body_bytes.to_vec())).await;
        Json(serde_json::json!({
            "status": "ok",
            "bytes": body_bytes.len(),
        }))
        .into_response()
    }
}

// ---------------------------------------------------------------------------
// WebSocket — streams transcription + TTS events to connected Node.js clients
// ---------------------------------------------------------------------------

async fn ws_handler(
    State(state): State<Arc<AppState>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: Arc<AppState>) {
    let mut rx = state.transcription_tx.subscribe();
    let mut tts_rx = state.tts_event_tx.subscribe();
    let mut speech_rx = state.speech_event_tx.subscribe();

    tracing::info!("WebSocket client connected");

    loop {
        tokio::select! {
            // Forward transcription events to client
            event = rx.recv() => {
                match event {
                    Ok(event) => {
                        // Empty text + !is_final = VAD speech_started event
                        let msg_type = if event.text.is_empty() && !event.is_final {
                            "speech_started"
                        } else {
                            "transcription"
                        };
                        let json = serde_json::json!({
                            "type": msg_type,
                            "sessionId": event.session_id,
                            "text": event.text,
                            "is_final": event.is_final,
                        });
                        if socket.send(Message::Text(json.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("WS client lagged, missed {} events", n);
                    }
                    Err(_) => break,
                }
            }
            // Forward TTS playback events to client
            tts_event = tts_rx.recv() => {
                match tts_event {
                    Ok(event) => {
                        let json = serde_json::json!({
                            "type": event.event_type,
                            "sessionId": event.session_id,
                            "utteranceId": event.utterance_id,
                        });
                        if socket.send(Message::Text(json.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("WS client lagged TTS events, missed {}", n);
                    }
                    Err(_) => break,
                }
            }
            // Forward user_speaking events from AEC energy detection
            speech_event = speech_rx.recv() => {
                match speech_event {
                    Ok(event) => {
                        let json = serde_json::json!({
                            "type": "user_speaking",
                            "sessionId": event.session_id,
                            "rms": event.rms,
                        });
                        if socket.send(Message::Text(json.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("WS client lagged speech events, missed {}", n);
                    }
                    Err(_) => break,
                }
            }
            // Handle incoming messages from client (for future use)
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Text(text))) => {
                        tracing::debug!("WS client message: {}", text);
                    }
                    _ => {}
                }
            }
        }
    }

    tracing::info!("WebSocket client disconnected");
}
