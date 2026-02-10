use clap::Parser;

use crate::audio::codec::AudioCodec;

#[derive(Parser, Debug, Clone)]
#[command(name = "ari-rtp-server")]
#[command(about = "High-performance RTP audio server for AriLink")]
pub struct Config {
    /// UDP address to listen for RTP packets (host:port)
    #[arg(long, env = "RTP_LISTEN_ADDR", default_value = "0.0.0.0:8000")]
    pub rtp_listen_addr: String,

    /// HTTP API port
    #[arg(long, env = "API_PORT", default_value_t = 9900)]
    pub api_port: u16,

    /// Default audio codec (ulaw, slin16, opus)
    #[arg(long, env = "DEFAULT_CODEC", default_value = "slin16")]
    pub default_codec: String,

    /// Transcription services, comma-separated WebSocket URLs
    /// Example: ws://localhost:5000,ws://localhost:5001
    #[arg(long, env = "TRANSCRIPTION_SERVICES", default_value = "")]
    pub transcription_services: String,

    /// Audio buffer flush interval in milliseconds
    #[arg(long, env = "BUFFER_FLUSH_MS", default_value_t = 100)]
    pub buffer_flush_ms: u64,
}

impl Config {
    /// Parse TRANSCRIPTION_SERVICES into a list of URLs.
    /// Filters out "google" keyword (not supported in Rust server, use Node.js for that).
    pub fn transcription_urls(&self) -> Vec<String> {
        self.transcription_services
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s.to_lowercase() != "google")
            .collect()
    }

    pub fn codec(&self) -> AudioCodec {
        AudioCodec::from_str(&self.default_codec)
    }
}
