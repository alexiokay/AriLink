use std::sync::Arc;

use clap::Parser;
use tokio::sync::broadcast;
use tracing_subscriber::EnvFilter;

mod api;
mod audio;
mod config;
mod rtp;
mod session;
mod transcription;

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
    tracing::info!("RTP listen: {}", config.rtp_listen_addr);
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
    let session_manager = Arc::new(SessionManager::new());

    let state = Arc::new(api::AppState {
        session_manager: session_manager.clone(),
        transcription_tx: tx,
        config: config.clone(),
    });

    // Start RTP UDP listener
    let listener_state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = rtp::listener::run(
            &listener_state.config.rtp_listen_addr,
            &listener_state.session_manager,
        )
        .await
        {
            tracing::error!("RTP listener fatal error: {}", e);
        }
    });

    // Start HTTP/WS API server (blocks)
    api::serve(state).await?;

    Ok(())
}
