use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use audio_codec::{Decoder as _, Encoder as _};
use serde::{Deserialize, Serialize};
use tokio::net::UdpSocket;
use tokio::sync::{broadcast, mpsc};

use crate::audio::aec::AEC_FRAME_SIZE;
use crate::rtp::builder::RtpBuilder;

/// Command sent from the HTTP API to the TTS injection task.
#[derive(Debug)]
pub enum TtsCommand {
    /// Raw slin16 PCM audio data to play (16kHz, i16 LE).
    Audio(Vec<u8>),
    /// All audio has been sent for this utterance.
    Done { utterance_id: String },
    /// Cancel current playback immediately.
    Cancel,
}

/// Event sent back to Node.js when TTS playback finishes or is cancelled.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TtsPlaybackEvent {
    pub session_id: String,
    pub event_type: String, // "tts_playback_done" or "tts_playback_cancelled"
    pub utterance_id: String,
}

/// Spawn the TTS injection task for a session.
///
/// Receives slin16 PCM (16kHz) from Node.js, encodes to G.722, and sends as
/// G.722 RTP (PT=9) at real-time pace via UDP to Asterisk's ExternalMedia channel.
///
/// Cancel commands are checked between every 20ms frame, so barge-in stops
/// audio within one frame (~20ms latency).
pub fn spawn_tts_injector(
    session_id: String,
    target_addr: SocketAddr,
    udp_socket: Arc<UdpSocket>,
    aec_ref_tx: Option<std::sync::mpsc::Sender<Vec<i16>>>,
    tts_active: Option<Arc<AtomicBool>>,
    event_tx: broadcast::Sender<TtsPlaybackEvent>,
) -> mpsc::Sender<TtsCommand> {
    let (tx, mut rx) = mpsc::channel::<TtsCommand>(256);

    tokio::spawn(async move {
        let mut rtp_builder = RtpBuilder::new_g722();
        let mut g722_encoder = audio_codec::g722::G722Encoder::new();
        let mut g722_decoder = audio_codec::g722::G722Decoder::new();

        let frame_samples = 320;
        let frame_bytes = frame_samples * 2; // 640 bytes (i16 LE)
        let frame_duration = std::time::Duration::from_micros(20_000);

        let mut pcm_buffer: Vec<u8> = Vec::with_capacity(8192);
        let mut current_utterance_id = String::new();
        // Track whether a Done was received during pacing (needs event emitted after pacing)
        let mut pending_done: Option<String> = None;

        tracing::info!("[{}] TTS injector started (G.722 PT=9 20ms) → {}", session_id, target_addr);

        loop {
            // Phase 1: If we have buffered audio, pace it frame-by-frame
            if pcm_buffer.len() >= frame_bytes {
                let pacing_start = tokio::time::Instant::now();
                let mut frame_index: u32 = 0;
                let mut cancelled = false;

                while pcm_buffer.len() >= frame_bytes {
                    let target_time = pacing_start + frame_duration * frame_index;

                    tokio::select! {
                        _ = tokio::time::sleep_until(target_time) => {}
                        cmd = rx.recv() => {
                            match cmd {
                                Some(TtsCommand::Cancel) => {
                                    let dropped = pcm_buffer.len();
                                    pcm_buffer.clear();
                                    cancelled = true;
                                    pending_done = None;

                                    if let Some(ref flag) = tts_active {
                                        flag.store(false, Ordering::Relaxed);
                                    }

                                    tracing::info!("[{}] TTS cancelled mid-playback (dropped {} bytes, {} frames sent)",
                                        session_id, dropped, frame_index);

                                    let _ = event_tx.send(TtsPlaybackEvent {
                                        session_id: session_id.clone(),
                                        event_type: "tts_playback_cancelled".into(),
                                        utterance_id: current_utterance_id.clone(),
                                    });
                                    break;
                                }
                                Some(TtsCommand::Audio(data)) => {
                                    pcm_buffer.extend_from_slice(&data);
                                    continue;
                                }
                                Some(TtsCommand::Done { utterance_id }) => {
                                    // Remember for after pacing completes
                                    current_utterance_id = utterance_id.clone();
                                    pending_done = Some(utterance_id);
                                    continue;
                                }
                                None => {
                                    pcm_buffer.clear();
                                    cancelled = true;
                                    break;
                                }
                            }
                        }
                    }

                    if cancelled { break; }

                    // Send one frame
                    let frame_data: Vec<u8> = pcm_buffer.drain(..frame_bytes).collect();
                    let samples: Vec<i16> = frame_data
                        .chunks_exact(2)
                        .map(|c| i16::from_le_bytes([c[0], c[1]]))
                        .collect();

                    let g722_payload = g722_encoder.encode(&samples);

                    if let Some(ref ref_tx) = aec_ref_tx {
                        let round_tripped: Vec<i16> = g722_decoder.decode(&g722_payload);
                        for chunk in round_tripped.chunks(AEC_FRAME_SIZE) {
                            let _ = ref_tx.send(chunk.to_vec());
                        }
                    }

                    let rtp_packet = rtp_builder.build_packet_raw(&g722_payload);
                    if let Err(e) = udp_socket.send_to(&rtp_packet, target_addr).await {
                        tracing::warn!("[{}] TTS RTP send error: {}", session_id, e);
                    }

                    frame_index += 1;
                }

                // After pacing loop: if Done was received during pacing and we weren't cancelled,
                // emit the done event now (all audio has been sent)
                if !cancelled {
                    if let Some(utterance_id) = pending_done.take() {
                        // Flush remaining partial frame
                        if !pcm_buffer.is_empty() {
                            pcm_buffer.resize(frame_bytes, 0);
                            let frame_data: Vec<u8> = pcm_buffer.drain(..).collect();
                            let samples: Vec<i16> = frame_data
                                .chunks_exact(2)
                                .map(|c| i16::from_le_bytes([c[0], c[1]]))
                                .collect();
                            let g722_payload = g722_encoder.encode(&samples);
                            if let Some(ref ref_tx) = aec_ref_tx {
                                let round_tripped: Vec<i16> = g722_decoder.decode(&g722_payload);
                                for chunk in round_tripped.chunks(AEC_FRAME_SIZE) {
                                    let _ = ref_tx.send(chunk.to_vec());
                                }
                            }
                            let rtp_packet = rtp_builder.build_packet_raw(&g722_payload);
                            let _ = udp_socket.send_to(&rtp_packet, target_addr).await;
                        }

                        if let Some(ref flag) = tts_active {
                            flag.store(false, Ordering::Relaxed);
                        }

                        tracing::info!("[{}] TTS playback done: {}", session_id, utterance_id);
                        let _ = event_tx.send(TtsPlaybackEvent {
                            session_id: session_id.clone(),
                            event_type: "tts_playback_done".into(),
                            utterance_id,
                        });
                    }
                }
            } else {
                // Phase 2: No buffered audio — wait for next command
                match rx.recv().await {
                    Some(TtsCommand::Audio(data)) => {
                        if let Some(ref flag) = tts_active {
                            flag.store(true, Ordering::Relaxed);
                        }
                        pcm_buffer.extend_from_slice(&data);
                    }
                    Some(TtsCommand::Done { utterance_id }) => {
                        // Flush remaining partial frame
                        if !pcm_buffer.is_empty() {
                            pcm_buffer.resize(frame_bytes, 0);
                            let frame_data: Vec<u8> = pcm_buffer.drain(..).collect();
                            let samples: Vec<i16> = frame_data
                                .chunks_exact(2)
                                .map(|c| i16::from_le_bytes([c[0], c[1]]))
                                .collect();
                            let g722_payload = g722_encoder.encode(&samples);
                            if let Some(ref ref_tx) = aec_ref_tx {
                                let round_tripped: Vec<i16> = g722_decoder.decode(&g722_payload);
                                for chunk in round_tripped.chunks(AEC_FRAME_SIZE) {
                                    let _ = ref_tx.send(chunk.to_vec());
                                }
                            }
                            let rtp_packet = rtp_builder.build_packet_raw(&g722_payload);
                            let _ = udp_socket.send_to(&rtp_packet, target_addr).await;
                        }

                        if let Some(ref flag) = tts_active {
                            flag.store(false, Ordering::Relaxed);
                        }

                        current_utterance_id = utterance_id.clone();
                        tracing::info!("[{}] TTS playback done: {}", session_id, utterance_id);
                        let _ = event_tx.send(TtsPlaybackEvent {
                            session_id: session_id.clone(),
                            event_type: "tts_playback_done".into(),
                            utterance_id,
                        });
                    }
                    Some(TtsCommand::Cancel) => {
                        let dropped = pcm_buffer.len();
                        pcm_buffer.clear();
                        pending_done = None;

                        if let Some(ref flag) = tts_active {
                            flag.store(false, Ordering::Relaxed);
                        }

                        tracing::info!("[{}] TTS playback cancelled (dropped {} bytes)",
                            session_id, dropped);

                        let _ = event_tx.send(TtsPlaybackEvent {
                            session_id: session_id.clone(),
                            event_type: "tts_playback_cancelled".into(),
                            utterance_id: current_utterance_id.clone(),
                        });
                    }
                    None => break,
                }
            }
        }

        tracing::info!("[{}] TTS injector stopped", session_id);
    });

    tx
}
