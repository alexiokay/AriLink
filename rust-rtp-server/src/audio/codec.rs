use serde::{Deserialize, Serialize};

/// Supported audio codecs from Asterisk ExternalMedia
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AudioCodec {
    /// G.711 μ-law (8kHz, 8-bit) → decoded + resampled to 16kHz PCM
    Ulaw,
    /// Signed Linear 16-bit (16kHz, big-endian from RTP) → byte-swapped to little-endian
    Slin16,
    /// Opus (48kHz) → decoded to 16kHz PCM
    Opus,
}

impl AudioCodec {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "ulaw" | "mulaw" | "pcmu" | "g711" => AudioCodec::Ulaw,
            "opus" => AudioCodec::Opus,
            _ => AudioCodec::Slin16,
        }
    }
}

impl std::fmt::Display for AudioCodec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AudioCodec::Ulaw => write!(f, "ulaw"),
            AudioCodec::Slin16 => write!(f, "slin16"),
            AudioCodec::Opus => write!(f, "opus"),
        }
    }
}

/// Stateful audio processor. Decodes RTP payload to 16kHz 16-bit PCM (little-endian).
/// One processor per session (Opus decoder is stateful across packets).
pub struct AudioProcessor {
    codec: AudioCodec,
    #[cfg(feature = "opus")]
    opus_decoder: Option<audiopus::coder::Decoder>,
}

impl AudioProcessor {
    pub fn new(codec: AudioCodec) -> Self {
        #[cfg(feature = "opus")]
        let opus_decoder = if codec == AudioCodec::Opus {
            // Decode directly to 16kHz — libopus handles internal resampling
            match audiopus::coder::Decoder::new(
                audiopus::SampleRate::Hz16000,
                audiopus::Channels::Mono,
            ) {
                Ok(dec) => {
                    tracing::info!("Opus decoder initialized (output: 16kHz mono)");
                    Some(dec)
                }
                Err(e) => {
                    tracing::error!("Failed to create Opus decoder: {}", e);
                    None
                }
            }
        } else {
            None
        };

        Self {
            codec,
            #[cfg(feature = "opus")]
            opus_decoder,
        }
    }

    /// Process raw RTP payload bytes → 16kHz 16-bit PCM (little-endian bytes).
    /// This is the format expected by transcription services (Parakeet, Whisper).
    pub fn process(&mut self, payload: &[u8]) -> Vec<u8> {
        match self.codec {
            AudioCodec::Slin16 => decode_slin16(payload),
            AudioCodec::Ulaw => decode_ulaw(payload),
            AudioCodec::Opus => self.decode_opus(payload),
        }
    }

    fn decode_opus(&mut self, payload: &[u8]) -> Vec<u8> {
        #[cfg(feature = "opus")]
        {
            let decoder = match &mut self.opus_decoder {
                Some(d) => d,
                None => {
                    tracing::warn!("Opus decoder not initialized");
                    return Vec::new();
                }
            };

            // Convert payload to audiopus Packet type
            let packet = match audiopus::packet::Packet::try_from(payload) {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!("Invalid Opus packet: {}", e);
                    return Vec::new();
                }
            };

            // Max Opus frame at 16kHz = 120ms = 1920 samples
            let mut pcm = vec![0i16; 1920];
            let signals = match audiopus::MutSignals::try_from(&mut pcm[..]) {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!("Failed to create MutSignals: {}", e);
                    return Vec::new();
                }
            };

            match decoder.decode(Some(packet), signals, false) {
                Ok(samples) => {
                    pcm.truncate(samples);
                    samples_to_bytes_le(&pcm)
                }
                Err(e) => {
                    tracing::warn!("Opus decode error: {}", e);
                    Vec::new()
                }
            }
        }

        #[cfg(not(feature = "opus"))]
        {
            let _ = payload;
            tracing::warn!("Opus not compiled in — build with: cargo build --features opus");
            Vec::new()
        }
    }
}

// ---------------------------------------------------------------------------
// SLIN16: big-endian 16-bit PCM → little-endian 16-bit PCM
// Already 16kHz, just need byte swap.
// ---------------------------------------------------------------------------

fn decode_slin16(payload: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(payload.len());
    for chunk in payload.chunks_exact(2) {
        // Swap bytes: big-endian → little-endian
        output.push(chunk[1]);
        output.push(chunk[0]);
    }
    output
}

// ---------------------------------------------------------------------------
// G.711 μ-law: 8kHz 8-bit → 16kHz 16-bit PCM (little-endian)
// Decode then resample 8kHz → 16kHz via linear interpolation.
// ---------------------------------------------------------------------------

fn decode_ulaw(payload: &[u8]) -> Vec<u8> {
    // Step 1: Decode μ-law to 16-bit PCM at 8kHz
    let pcm_8k: Vec<i16> = payload.iter().map(|&b| ulaw_to_linear(b)).collect();

    // Step 2: Resample 8kHz → 16kHz
    let pcm_16k = resample_linear(&pcm_8k, 8000, 16000);

    // Step 3: Convert samples to little-endian bytes
    samples_to_bytes_le(&pcm_16k)
}

/// ITU-T G.711 μ-law to linear PCM (16-bit) conversion.
///
/// Standard algorithm:
/// 1. Complement input byte
/// 2. Extract sign (bit 7), exponent (bits 6-4), mantissa (bits 3-0)
/// 3. Reconstruct linear sample
fn ulaw_to_linear(u_val: u8) -> i16 {
    let u_val = !u_val;
    let sign = u_val & 0x80;
    let exponent = ((u_val & 0x70) >> 4) as u32;
    let mantissa = (u_val & 0x0F) as i32;

    // Reconstruct: ((mantissa << 3) + bias) << exponent, then subtract bias
    let mut sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;

    if sign != 0 {
        -sample as i16
    } else {
        sample as i16
    }
}

/// Linear interpolation resampling.
/// Good enough for speech transcription — no need for sinc/polyphase filters.
fn resample_linear(input: &[i16], from_rate: u32, to_rate: u32) -> Vec<i16> {
    if from_rate == to_rate || input.is_empty() {
        return input.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (input.len() as f64 / ratio).ceil() as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_pos = i as f64 * ratio;
        let src_idx = src_pos as usize;
        let frac = src_pos - src_idx as f64;

        let sample = if src_idx + 1 < input.len() {
            let s0 = input[src_idx] as f64;
            let s1 = input[src_idx + 1] as f64;
            (s0 + frac * (s1 - s0)) as i16
        } else if src_idx < input.len() {
            input[src_idx]
        } else {
            0
        };
        output.push(sample);
    }

    output
}

/// Convert i16 PCM samples to little-endian byte pairs.
fn samples_to_bytes_le(samples: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ulaw_silence_decodes_to_zero() {
        // μ-law silence = 0xFF (positive) and 0x7F (negative)
        let pos = ulaw_to_linear(0xFF);
        let neg = ulaw_to_linear(0x7F);
        assert_eq!(pos, 0);
        assert_eq!(neg, 0);
    }

    #[test]
    fn ulaw_range_is_reasonable() {
        // Max positive (0x80 → complement 0x7F)
        let max_pos = ulaw_to_linear(0x80);
        assert!(max_pos > 30000, "max positive = {}", max_pos);

        // Max negative (0x00 → complement 0xFF)
        let max_neg = ulaw_to_linear(0x00);
        assert!(max_neg < -30000, "max negative = {}", max_neg);
    }

    #[test]
    fn slin16_byte_swap() {
        let input = vec![0x01, 0x02, 0x03, 0x04];
        let output = decode_slin16(&input);
        assert_eq!(output, vec![0x02, 0x01, 0x04, 0x03]);
    }

    #[test]
    fn resample_8k_to_16k_doubles_length() {
        let input: Vec<i16> = vec![100, 200, 300, 400];
        let output = resample_linear(&input, 8000, 16000);
        // Output should be approximately double the length
        assert_eq!(output.len(), 8);
        // First sample should match
        assert_eq!(output[0], 100);
    }

    #[test]
    fn resample_identity() {
        let input: Vec<i16> = vec![1, 2, 3, 4, 5];
        let output = resample_linear(&input, 16000, 16000);
        assert_eq!(output, input);
    }
}
