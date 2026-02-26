use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use dashmap::DashMap;
use serde::Serialize;
use tokio::net::UdpSocket;
use tokio::sync::{broadcast, mpsc};

use crate::audio::aec::{AecHandle, UserSpeakingEvent};
use crate::audio::codec::AudioCodec;
use crate::transcription;
use crate::tts::{self, TtsCommand, TtsPlaybackEvent};

/// Per-call session. Created via the HTTP API, receives audio from the RTP listener,
/// and forwards decoded PCM to a transcription service via WebSocket.
pub struct Session {
    pub id: String,
    pub codec: AudioCodec,
    pub transcription_urls: Vec<String>,
    /// Send decoded PCM audio chunks to the transcription task
    pub audio_tx: mpsc::Sender<Vec<u8>>,
    pub packets_received: AtomicU64,
    pub bytes_received: AtomicU64,
    pub created_at: Instant,

    // --- AEC + TTS (only when aec_enabled) ---

    /// AEC processing handle. When present, the RTP listener routes mic audio
    /// through the AEC thread instead of directly to audio_tx.
    pub aec_handle: Option<AecHandle>,
    /// Send TTS commands to the injection task. Set via configure_tts().
    pub tts_cmd_tx: std::sync::OnceLock<mpsc::Sender<TtsCommand>>,
    /// Target address for outbound TTS RTP (ExternalMedia OUT on Asterisk).
    pub tts_target_addr: std::sync::OnceLock<SocketAddr>,
}

/// Serializable session info for the HTTP API
#[derive(Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub codec: String,
    pub source_addr: Option<String>,
    pub transcription_urls: Vec<String>,
    pub packets_received: u64,
    pub bytes_received: u64,
    pub uptime_secs: u64,
    pub aec_enabled: bool,
    pub tts_configured: bool,
}

/// Manages all active call sessions. Thread-safe via DashMap.
pub struct SessionManager {
    sessions: DashMap<String, Arc<Session>>,
    /// Maps source SocketAddr → session ID for packet routing
    source_to_session: DashMap<SocketAddr, String>,
    /// Sessions waiting for TTS target address auto-detection (FIFO).
    /// When a new source is detected on port 8001, the first pending session gets configured.
    pending_tts: std::sync::Mutex<Vec<PendingTts>>,
}

/// Info needed to complete TTS configuration once the target address is auto-detected.
struct PendingTts {
    session_id: String,
    udp_socket: Arc<UdpSocket>,
    event_tx: broadcast::Sender<TtsPlaybackEvent>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            source_to_session: DashMap::new(),
            pending_tts: std::sync::Mutex::new(Vec::new()),
        }
    }

    /// Create a new session and spawn its transcription task.
    /// If `caller_id` is provided, it's used as the session ID (e.g. Node.js passes its own).
    /// Otherwise a UUID is generated.
    /// When `aec_enabled` is true, an AEC processing thread is spawned that routes
    /// mic audio through echo cancellation before reaching the transcription pipeline.
    /// Returns the session ID.
    pub fn create_session(
        &self,
        caller_id: Option<String>,
        codec: AudioCodec,
        transcription_urls: Vec<String>,
        source_addr: Option<SocketAddr>,
        transcription_tx: broadcast::Sender<transcription::TranscriptionEvent>,
        buffer_flush_ms: u64,
        aec_enabled: bool,
        speech_event_tx: Option<broadcast::Sender<UserSpeakingEvent>>,
    ) -> String {
        let id = caller_id
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let (audio_tx, audio_rx) = mpsc::channel::<Vec<u8>>(1024);

        // If AEC is enabled, spawn a dedicated echo cancellation thread.
        // The AEC thread reads mic audio from its channel, cancels echo using
        // TTS reference frames, and outputs clean audio to audio_tx → transcription.
        let aec_handle = if aec_enabled {
            let handle = AecHandle::spawn(id.clone(), audio_tx.clone());

            // Forward per-session speech detection events to global broadcast
            if let Some(ref global_tx) = speech_event_tx {
                let mut local_rx = handle.speech_event_tx.subscribe();
                let global_tx = global_tx.clone();
                tokio::spawn(async move {
                    loop {
                        match local_rx.recv().await {
                            Ok(event) => { let _ = global_tx.send(event); }
                            Err(broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(_) => break,
                        }
                    }
                });
            }

            Some(handle)
        } else {
            None
        };

        let session = Arc::new(Session {
            id: id.clone(),
            codec: codec.clone(),
            transcription_urls: transcription_urls.clone(),
            audio_tx,
            packets_received: AtomicU64::new(0),
            bytes_received: AtomicU64::new(0),
            created_at: Instant::now(),
            aec_handle,
            tts_cmd_tx: std::sync::OnceLock::new(),
            tts_target_addr: std::sync::OnceLock::new(),
        });

        // Bind source address if known
        if let Some(addr) = source_addr {
            self.source_to_session.insert(addr, id.clone());
        }

        self.sessions.insert(id.clone(), session);

        // Spawn the transcription forwarding task
        let session_id = id.clone();
        tokio::spawn(async move {
            transcription::run_session(
                session_id,
                audio_rx,
                transcription_urls,
                transcription_tx,
                buffer_flush_ms,
            )
            .await;
        });

        tracing::info!("Session {} created (codec: {}, services: {})",
            id, codec, self.sessions.len());

        id
    }

    /// Remove a session and clean up source mappings.
    /// The transcription task will stop when the audio_tx sender is dropped.
    pub fn remove_session(&self, id: &str) -> bool {
        if let Some((_, _session)) = self.sessions.remove(id) {
            // Remove any source address bindings for this session
            self.source_to_session.retain(|_, v| v != id);
            tracing::info!("Session {} removed", id);
            true
        } else {
            false
        }
    }

    /// Get a session by ID
    pub fn get(&self, id: &str) -> Option<Arc<Session>> {
        self.sessions.get(id).map(|s| s.value().clone())
    }

    /// Find session ID by source socket address
    pub fn find_by_source(&self, addr: &SocketAddr) -> Option<String> {
        self.source_to_session.get(addr).map(|v| v.value().clone())
    }

    /// Bind a source address to an existing session
    pub fn bind_source(&self, session_id: &str, addr: SocketAddr) {
        if self.sessions.contains_key(session_id) {
            self.source_to_session
                .insert(addr, session_id.to_string());
        }
    }

    /// Auto-assign the first unbound session to a new source address.
    /// Useful when Node.js doesn't pre-register the source.
    pub fn assign_unbound_session(&self, addr: &SocketAddr) -> Option<String> {
        // Find a session that has no source binding
        let bound_ids: std::collections::HashSet<String> = self
            .source_to_session
            .iter()
            .map(|entry| entry.value().clone())
            .collect();

        for entry in self.sessions.iter() {
            let id = entry.key().clone();
            if !bound_ids.contains(&id) {
                self.source_to_session.insert(*addr, id.clone());
                return Some(id);
            }
        }

        None
    }

    /// Configure TTS injection for a session.
    /// Creates the TTS injector task and wires it to the AEC reference channel.
    /// Called after ExternalMedia OUT is created and its RTP address is known.
    pub fn configure_tts(
        &self,
        session_id: &str,
        target_addr: SocketAddr,
        udp_socket: Arc<UdpSocket>,
        event_tx: broadcast::Sender<TtsPlaybackEvent>,
    ) -> bool {
        if let Some(session) = self.get(session_id) {
            // Get AEC reference channel and tts_active flag if AEC is enabled
            let aec_ref_tx = session
                .aec_handle
                .as_ref()
                .map(|h| h.ref_tx.clone());
            let tts_active = session
                .aec_handle
                .as_ref()
                .map(|h| h.tts_active.clone());

            // Spawn TTS injection task
            let cmd_tx = tts::spawn_tts_injector(
                session_id.to_string(),
                target_addr,
                udp_socket,
                aec_ref_tx,
                tts_active,
                event_tx,
            );

            let _ = session.tts_target_addr.set(target_addr);
            let _ = session.tts_cmd_tx.set(cmd_tx);

            tracing::info!("Session {} TTS configured → {}", session_id, target_addr);
            true
        } else {
            false
        }
    }

    /// Enqueue a session for deferred TTS configuration.
    /// The TTS target address will be auto-detected when the first RTP packet
    /// arrives on port 8001 from Asterisk's ExternalMedia OUT channel.
    pub fn enqueue_pending_tts(
        &self,
        session_id: &str,
        udp_socket: Arc<UdpSocket>,
        event_tx: broadcast::Sender<TtsPlaybackEvent>,
    ) {
        if let Ok(mut pending) = self.pending_tts.lock() {
            pending.push(PendingTts {
                session_id: session_id.to_string(),
                udp_socket,
                event_tx,
            });
            tracing::info!("Session {} enqueued for TTS auto-detection", session_id);
        }
    }

    /// Find the bound RTP source address for a given session.
    /// This is the address Asterisk sends mic audio FROM on port 8000.
    /// For bidirectional ExternalMedia, this is also where we send TTS RTP back to.
    pub fn find_source_for_session(&self, session_id: &str) -> Option<SocketAddr> {
        self.source_to_session
            .iter()
            .find(|e| e.value() == session_id)
            .map(|e| *e.key())
    }

    /// Called when a new RTP source is detected on port 8001 (TTS socket).
    /// Auto-configures the first pending session with the detected target address.
    /// Returns true if a session was configured.
    pub fn auto_configure_tts_from_source(&self, source_addr: SocketAddr) -> bool {
        let pending = {
            let mut queue = match self.pending_tts.lock() {
                Ok(q) => q,
                Err(_) => return false,
            };
            if queue.is_empty() {
                return false;
            }
            queue.remove(0) // FIFO
        };

        self.configure_tts(
            &pending.session_id,
            source_addr,
            pending.udp_socket,
            pending.event_tx,
        )
    }

    /// Number of active sessions
    pub fn count(&self) -> usize {
        self.sessions.len()
    }

    /// List all sessions with their info
    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions
            .iter()
            .map(|entry| {
                let session = entry.value();
                let source = self
                    .source_to_session
                    .iter()
                    .find(|e| e.value() == &session.id)
                    .map(|e| e.key().to_string());

                SessionInfo {
                    id: session.id.clone(),
                    codec: session.codec.to_string(),
                    source_addr: source,
                    transcription_urls: session.transcription_urls.clone(),
                    packets_received: session.packets_received.load(Ordering::Relaxed),
                    bytes_received: session.bytes_received.load(Ordering::Relaxed),
                    uptime_secs: session.created_at.elapsed().as_secs(),
                    aec_enabled: session.aec_handle.is_some(),
                    tts_configured: session.tts_cmd_tx.get().is_some(),
                }
            })
            .collect()
    }

    /// Get info for a single session
    pub fn get_info(&self, id: &str) -> Option<SessionInfo> {
        self.sessions.get(id).map(|entry| {
            let session = entry.value();
            let source = self
                .source_to_session
                .iter()
                .find(|e| e.value() == &session.id)
                .map(|e| e.key().to_string());

            SessionInfo {
                id: session.id.clone(),
                codec: session.codec.to_string(),
                source_addr: source,
                transcription_urls: session.transcription_urls.clone(),
                packets_received: session.packets_received.load(Ordering::Relaxed),
                bytes_received: session.bytes_received.load(Ordering::Relaxed),
                uptime_secs: session.created_at.elapsed().as_secs(),
                aec_enabled: session.aec_handle.is_some(),
                tts_configured: session.tts_cmd_tx.get().is_some(),
            }
        })
    }
}
