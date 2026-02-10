use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use dashmap::DashMap;
use serde::Serialize;
use tokio::sync::{broadcast, mpsc};

use crate::audio::codec::AudioCodec;
use crate::transcription;

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
}

/// Manages all active call sessions. Thread-safe via DashMap.
pub struct SessionManager {
    sessions: DashMap<String, Arc<Session>>,
    /// Maps source SocketAddr → session ID for packet routing
    source_to_session: DashMap<SocketAddr, String>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            source_to_session: DashMap::new(),
        }
    }

    /// Create a new session and spawn its transcription task.
    /// If `caller_id` is provided, it's used as the session ID (e.g. Node.js passes its own).
    /// Otherwise a UUID is generated.
    /// Returns the session ID.
    pub fn create_session(
        &self,
        caller_id: Option<String>,
        codec: AudioCodec,
        transcription_urls: Vec<String>,
        source_addr: Option<SocketAddr>,
        transcription_tx: broadcast::Sender<transcription::TranscriptionEvent>,
        buffer_flush_ms: u64,
    ) -> String {
        let id = caller_id
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let (audio_tx, audio_rx) = mpsc::channel::<Vec<u8>>(1024);

        let session = Arc::new(Session {
            id: id.clone(),
            codec: codec.clone(),
            transcription_urls: transcription_urls.clone(),
            audio_tx,
            packets_received: AtomicU64::new(0),
            bytes_received: AtomicU64::new(0),
            created_at: Instant::now(),
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
            }
        })
    }
}
