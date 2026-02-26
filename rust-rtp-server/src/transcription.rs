use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::{broadcast, mpsc};
use tokio::time::interval;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

/// Transcription event broadcast to connected Node.js clients
#[derive(Clone, Debug)]
pub struct TranscriptionEvent {
    pub session_id: String,
    pub text: String,
    pub is_final: bool,
}

/// Run the transcription pipeline for a single session.
/// Connects to transcription services, sends audio, receives transcription results.
/// Implements failover: tries services in order, retries on failure.
pub async fn run_session(
    session_id: String,
    mut audio_rx: mpsc::Receiver<Vec<u8>>,
    transcription_urls: Vec<String>,
    tx: broadcast::Sender<TranscriptionEvent>,
    buffer_flush_ms: u64,
) {
    if transcription_urls.is_empty() {
        tracing::warn!("[{}] No transcription services configured, discarding audio", session_id);
        // Drain audio channel until session ends
        while audio_rx.recv().await.is_some() {}
        return;
    }

    let max_retries = 3u32;
    let mut current_idx = 0usize;
    let mut retry_count = 0u32;

    loop {
        let url = &transcription_urls[current_idx];
        let label = if current_idx == 0 { "PRIMARY" } else { "BACKUP" };

        tracing::info!(
            "[{}] Connecting to {} transcription service: {}",
            session_id, label, url
        );

        match stream_to_service(
            &session_id,
            &mut audio_rx,
            url,
            &tx,
            buffer_flush_ms,
        )
        .await
        {
            Ok(SessionEnd::Normal) => {
                tracing::info!("[{}] Session ended normally", session_id);
                return;
            }
            Ok(SessionEnd::AudioChannelClosed) => {
                tracing::info!("[{}] Audio channel closed (session removed)", session_id);
                return;
            }
            Err(e) => {
                retry_count += 1;
                tracing::warn!(
                    "[{}] {} service error (attempt {}/{}): {}",
                    session_id, label, retry_count, max_retries, e
                );

                if retry_count >= max_retries {
                    // Switch to next service
                    current_idx = (current_idx + 1) % transcription_urls.len();
                    retry_count = 0;

                    if current_idx == 0 {
                        tracing::error!(
                            "[{}] All transcription services failed, cycling back to primary after delay",
                            session_id
                        );
                        tokio::time::sleep(Duration::from_secs(5)).await;
                    } else {
                        tracing::warn!(
                            "[{}] Switching to: {}",
                            session_id, transcription_urls[current_idx]
                        );
                    }
                } else {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }

                // Drain any buffered audio during the reconnection gap
                // and check if the session was removed (audio_tx dropped)
                loop {
                    match audio_rx.try_recv() {
                        Ok(_) => continue,
                        Err(mpsc::error::TryRecvError::Empty) => break,
                        Err(mpsc::error::TryRecvError::Disconnected) => {
                            tracing::info!("[{}] Audio channel closed, stopping transcription retries", session_id);
                            return;
                        }
                    }
                }
            }
        }
    }
}

enum SessionEnd {
    Normal,
    AudioChannelClosed,
}

/// Connect to a transcription service and stream audio until disconnect or session end.
async fn stream_to_service(
    session_id: &str,
    audio_rx: &mut mpsc::Receiver<Vec<u8>>,
    url: &str,
    tx: &broadcast::Sender<TranscriptionEvent>,
    buffer_flush_ms: u64,
) -> anyhow::Result<SessionEnd> {
    let (ws_stream, _response) = connect_async(url).await?;
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    tracing::info!("[{}] Connected to transcription service: {}", session_id, url);

    // Send ping to verify connection
    ws_tx
        .send(Message::Text(r#"{"type":"ping"}"#.to_string()))
        .await?;

    // Audio buffer — flush every buffer_flush_ms
    let mut buffer: Vec<u8> = Vec::with_capacity(8192);
    let mut flush_timer = interval(Duration::from_millis(buffer_flush_ms));

    // Spawn task to read transcription results from the service
    let tx_clone = tx.clone();
    let read_session_id = session_id.to_string();
    let (read_done_tx, mut read_done_rx) = mpsc::channel::<()>(1);

    tokio::spawn(async move {
        while let Some(msg) = ws_rx.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    handle_transcription_message(&read_session_id, &text, &tx_clone);
                }
                Ok(Message::Close(_)) => {
                    tracing::info!("[{}] Transcription service closed connection", read_session_id);
                    break;
                }
                Err(e) => {
                    tracing::warn!("[{}] WS read error: {}", read_session_id, e);
                    break;
                }
                _ => {}
            }
        }
        // Signal that the read side is done
        let _ = read_done_tx.send(()).await;
    });

    // Main loop: receive audio chunks and flush to WebSocket
    let result = loop {
        tokio::select! {
            // Receive audio from RTP listener
            audio = audio_rx.recv() => {
                match audio {
                    Some(data) => {
                        buffer.extend_from_slice(&data);
                    }
                    None => {
                        // audio_tx was dropped → session removed
                        // Flush remaining buffer
                        if !buffer.is_empty() {
                            let _ = ws_tx.send(Message::Binary(buffer.drain(..).collect())).await;
                        }
                        break Ok(SessionEnd::AudioChannelClosed);
                    }
                }
            }
            // Flush buffer on timer
            _ = flush_timer.tick() => {
                if !buffer.is_empty() {
                    let data: Vec<u8> = buffer.drain(..).collect();
                    if let Err(e) = ws_tx.send(Message::Binary(data)).await {
                        break Err(anyhow::anyhow!("WS send error: {}", e));
                    }
                }
            }
            // Read task finished (service disconnected)
            _ = read_done_rx.recv() => {
                break Err(anyhow::anyhow!("Transcription service disconnected"));
            }
        }
    };

    // Try to close WebSocket gracefully
    let _ = ws_tx.send(Message::Close(None)).await;

    result
}

/// Parse a transcription message from the service and broadcast it.
fn handle_transcription_message(
    session_id: &str,
    text: &str,
    tx: &broadcast::Sender<TranscriptionEvent>,
) {
    let json: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };

    match json["type"].as_str() {
        Some("transcription") => {
            let transcription_text = json["text"].as_str().unwrap_or("").to_string();
            let is_final = json["is_final"].as_bool().unwrap_or(true);

            if !transcription_text.trim().is_empty() {
                tracing::info!("[{}] Transcription: {}", session_id, transcription_text);
                let _ = tx.send(TranscriptionEvent {
                    session_id: session_id.to_string(),
                    text: transcription_text,
                    is_final,
                });
            }
        }
        Some("speech_started") => {
            // VAD detected speech start — forward immediately for barge-in.
            // Sent as a TranscriptionEvent with empty text so it flows through
            // the existing broadcast channel without schema changes.
            tracing::debug!("[{}] Speech started (VAD)", session_id);
            let _ = tx.send(TranscriptionEvent {
                session_id: session_id.to_string(),
                text: String::new(),
                is_final: false,
            });
        }
        Some("pong") => {
            tracing::debug!("[{}] Received pong from service", session_id);
        }
        _ => {}
    }
}
