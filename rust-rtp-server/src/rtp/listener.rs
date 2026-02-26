use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tokio::net::UdpSocket;

use crate::audio::codec::AudioProcessor;
use crate::rtp::RtpPacket;
use crate::session::SessionManager;

/// Run the RTP UDP listener. Receives packets, decodes audio, routes to sessions.
pub async fn run(socket: Arc<UdpSocket>, session_manager: &Arc<SessionManager>) -> anyhow::Result<()> {
    let mut buf = [0u8; 2048]; // Max RTP packet fits in MTU (~1500 bytes)
    let mut processors: HashMap<String, AudioProcessor> = HashMap::new();

    loop {
        let (len, src) = socket.recv_from(&mut buf).await?;

        // Parse RTP header (zero-copy)
        let packet = match RtpPacket::parse(&buf[..len]) {
            Some(p) => p,
            None => {
                tracing::trace!("Invalid RTP packet from {}, dropping", src);
                continue;
            }
        };

        let payload = packet.payload();
        if payload.is_empty() {
            continue;
        }

        // Route packet to session by source address
        let session_id = match session_manager.find_by_source(&src) {
            Some(id) => id,
            None => {
                // Try to auto-assign to an unbound session
                match session_manager.assign_unbound_session(&src) {
                    Some(id) => {
                        tracing::info!(
                            "Auto-bound session {} to source {} (PT={}, payload_len={})",
                            id, src, packet.payload_type(), payload.len()
                        );
                        id
                    }
                    None => {
                        tracing::trace!("No session for source {}, dropping", src);
                        continue;
                    }
                }
            }
        };

        // Get session and process audio
        if let Some(session) = session_manager.get(&session_id) {
            // Get or create codec processor for this session
            let processor = processors
                .entry(session_id.clone())
                .or_insert_with(|| AudioProcessor::new(session.codec.clone()));

            // Decode RTP payload → 16kHz 16-bit PCM (little-endian)
            let pcm_data = processor.process(payload);

            if !pcm_data.is_empty() {
                // Update stats
                session
                    .packets_received
                    .fetch_add(1, Ordering::Relaxed);
                session
                    .bytes_received
                    .fetch_add(pcm_data.len() as u64, Ordering::Relaxed);

                // Route audio: through AEC if enabled, otherwise direct to transcription
                if let Some(ref aec_handle) = session.aec_handle {
                    // AEC thread will cancel echo and forward clean audio to audio_tx
                    if aec_handle.mic_tx.send(pcm_data).is_err() {
                        tracing::trace!("Session {} AEC mic channel closed", session_id);
                    }
                } else {
                    // Direct to transcription pipeline (no AEC)
                    if session.audio_tx.try_send(pcm_data).is_err() {
                        tracing::trace!("Session {} audio channel full, dropping packet", session_id);
                    }
                }
            }
        } else {
            // Session was removed, clean up processor
            processors.remove(&session_id);
        }
    }
}
