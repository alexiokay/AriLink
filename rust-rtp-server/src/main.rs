use std::sync::Arc;

use clap::Parser;
use tokio::net::UdpSocket;
use tokio::sync::broadcast;
use tracing_subscriber::EnvFilter;

mod api;
mod audio;
mod config;
mod rtp;
mod session;
mod transcription;
mod tts;

use config::Config;
use session::SessionManager;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env from current dir, or parent dir (when running from rtp-server/)
    if dotenvy::dotenv().is_err() {
        dotenvy::from_filename("../.env").ok();
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("ari_rtp_server=info")),
        )
        .init();

    let config = Config::parse();

    tracing::info!("=== ARI RTP Server ===");
    tracing::info!("RTP IN:     {}", config.rtp_listen_addr);
    tracing::info!("RTP OUT:    {} (TTS)", config.rtp_tts_addr);
    tracing::info!("API port:   {}", config.api_port);
    tracing::info!("Codec:      {}", config.default_codec);
    tracing::info!("Buffer:     {}ms", config.buffer_flush_ms);

    if cfg!(feature = "opus") {
        tracing::info!("Opus codec: enabled");
    } else {
        tracing::info!("Opus codec: disabled (compile with --features opus)");
    }

    let transcription_urls = config.transcription_urls();
    if !transcription_urls.is_empty() {
        tracing::info!("Transcription services:");
        for (i, url) in transcription_urls.iter().enumerate() {
            let label = if i == 0 { "PRIMARY" } else { "BACKUP" };
            tracing::info!("  {}: {}", label, url);
        }
    }

    let (tx, _rx) = broadcast::channel::<transcription::TranscriptionEvent>(1024);
    let (tts_event_tx, _tts_event_rx) = broadcast::channel::<tts::TtsPlaybackEvent>(256);
    let (speech_event_tx, _speech_event_rx) = broadcast::channel::<audio::aec::UserSpeakingEvent>(64);
    let session_manager = Arc::new(SessionManager::new());

    // Create UDP socket for RTP audio (bidirectional: IN from Asterisk + OUT for TTS)
    let udp_socket = Arc::new(UdpSocket::bind(&config.rtp_listen_addr).await?);
    tracing::info!("RTP socket bound to {} (bidirectional: mic IN + TTS OUT)", config.rtp_listen_addr);

    // Keep port 8001 bound for backward compatibility (auto-detection listener)
    let tts_udp_socket = Arc::new(UdpSocket::bind(&config.rtp_tts_addr).await?);
    tracing::info!("RTP TTS socket bound to {} (auto-detect only)", config.rtp_tts_addr);

    let state = Arc::new(api::AppState {
        session_manager: session_manager.clone(),
        transcription_tx: tx,
        tts_event_tx,
        speech_event_tx,
        rtp_socket: udp_socket.clone(),
        tts_udp_socket: tts_udp_socket.clone(),
        config: config.clone(),
    });

    // Start RTP UDP listener (ExternalMedia IN → transcription)
    let listener_sm = session_manager.clone();
    tokio::spawn(async move {
        if let Err(e) = rtp::listener::run(udp_socket, &listener_sm).await {
            tracing::error!("RTP listener fatal error: {}", e);
        }
    });

    // TTS UDP socket listener — receives audio Asterisk sends back from the bridge mix
    // on port 8001. We discard the audio but use the first packet from each new source
    // to auto-detect the ExternalMedia OUT RTP address for TTS injection.
    let tts_detect_sm = session_manager.clone();
    tokio::spawn(async move {
        let mut drain_buf = [0u8; 2048];
        let mut known_sources = std::collections::HashSet::<std::net::SocketAddr>::new();
        loop {
            match tts_udp_socket.recv_from(&mut drain_buf).await {
                Ok((_len, src_addr)) => {
                    if known_sources.insert(src_addr) {
                        // New source detected — try to auto-configure a pending TTS session
                        tracing::info!("TTS port 8001: new source detected: {}", src_addr);
                        if tts_detect_sm.auto_configure_tts_from_source(src_addr) {
                            tracing::info!("TTS auto-configured session from source {}", src_addr);
                        }
                    }
                    // Discard audio data — we only send to this socket
                }
                Err(_) => break,
            }
        }
    });

    // Start HTTP/WS API server (blocks)
    api::serve(state).await?;

    Ok(())
}
