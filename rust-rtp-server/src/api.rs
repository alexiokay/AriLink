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

use crate::audio::codec::AudioCodec;
use crate::config::Config;
use crate::session::{SessionInfo, SessionManager};
use crate::transcription::TranscriptionEvent;

/// Shared application state
pub struct AppState {
    pub session_manager: Arc<SessionManager>,
    pub transcription_tx: broadcast::Sender<TranscriptionEvent>,
    pub config: Config,
}

/// Start the HTTP/WebSocket API server
pub async fn serve(state: Arc<AppState>) -> anyhow::Result<()> {
    let app = Router::new()
        .route("/health", get(health))
        .route("/sessions", get(list_sessions).post(create_session))
        .route("/sessions/:id", get(get_session).delete(delete_session))
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
// WebSocket — streams transcription events to connected Node.js clients
// ---------------------------------------------------------------------------

async fn ws_handler(
    State(state): State<Arc<AppState>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: Arc<AppState>) {
    let mut rx = state.transcription_tx.subscribe();

    tracing::info!("WebSocket client connected");

    loop {
        tokio::select! {
            // Forward transcription events to client
            event = rx.recv() => {
                match event {
                    Ok(event) => {
                        let json = serde_json::json!({
                            "type": "transcription",
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
