/// Builds outbound RTP packets for sending audio to Asterisk ExternalMedia.
///
/// Supports three modes:
/// - slin16: 16-bit signed, big-endian, 16kHz (PT=118 dynamic, 320 samples/20ms)
/// - ulaw: G.711 μ-law, 8kHz (PT=0, standard telephony)
/// - g722: ITU-T G.722 wideband, 16kHz audio (PT=9, clock=8kHz per RFC 3551)
pub struct RtpBuilder {
    sequence: u16,
    timestamp: u32,
    ssrc: u32,
    payload_type: u8,
    /// Timestamp increment per frame
    ts_increment: u32,
}

impl RtpBuilder {
    /// Create builder for slin16 at 16kHz.
    /// PT=118 matches Asterisk's dynamic payload type for slin16 ExternalMedia.
    /// 320 samples per frame = 20ms at 16kHz (matches Asterisk's packetization).
    pub fn new_slin16() -> Self {
        Self {
            sequence: rand::random(),
            timestamp: rand::random(),
            ssrc: rand::random(),
            payload_type: 118,
            ts_increment: 320, // 20ms at 16kHz
        }
    }

    /// Create builder for G.711 μ-law at 8kHz.
    /// PT=0 is the standard static payload type for PCMU.
    pub fn new_ulaw() -> Self {
        Self {
            sequence: rand::random(),
            timestamp: rand::random(),
            ssrc: rand::random(),
            payload_type: 0,
            ts_increment: 80, // 10ms at 8kHz
        }
    }

    /// Create builder for G.722 wideband at 16kHz.
    /// PT=9 is the static payload type per RFC 3551.
    /// Clock rate is 8000 Hz (historical quirk) despite 16kHz audio.
    /// 20ms frame = 160 clock ticks (8000 * 0.02).
    pub fn new_g722() -> Self {
        Self {
            sequence: rand::random(),
            timestamp: rand::random(),
            ssrc: rand::random(),
            payload_type: 9,
            ts_increment: 160, // 20ms at 8kHz clock rate
        }
    }

    /// Build an RTP packet with raw payload (no byte swapping).
    /// Used for ulaw and other byte-stream codecs.
    pub fn build_packet_raw(&mut self, payload: &[u8]) -> Vec<u8> {
        let header_len = 12;
        let mut packet = Vec::with_capacity(header_len + payload.len());

        // RTP header
        packet.push(0x80); // V=2, P=0, X=0, CC=0
        packet.push(self.payload_type & 0x7F); // M=0, PT
        packet.extend_from_slice(&self.sequence.to_be_bytes());
        packet.extend_from_slice(&self.timestamp.to_be_bytes());
        packet.extend_from_slice(&self.ssrc.to_be_bytes());

        // Payload as-is
        packet.extend_from_slice(payload);

        self.sequence = self.sequence.wrapping_add(1);
        self.timestamp = self.timestamp.wrapping_add(self.ts_increment);

        packet
    }

    /// Build an RTP packet from slin16 LE PCM payload.
    /// Swaps each i16 from LE → BE for L16 wire format.
    pub fn build_packet(&mut self, pcm_le: &[u8]) -> Vec<u8> {
        let header_len = 12;
        let payload_len = pcm_le.len();
        let mut packet = Vec::with_capacity(header_len + payload_len);

        // RTP header
        packet.push(0x80);
        packet.push(self.payload_type & 0x7F);
        packet.extend_from_slice(&self.sequence.to_be_bytes());
        packet.extend_from_slice(&self.timestamp.to_be_bytes());
        packet.extend_from_slice(&self.ssrc.to_be_bytes());

        // Payload: swap each i16 from LE → BE for L16 wire format
        for chunk in pcm_le.chunks_exact(2) {
            packet.push(chunk[1]);
            packet.push(chunk[0]);
        }

        self.sequence = self.sequence.wrapping_add(1);
        self.timestamp = self.timestamp.wrapping_add(self.ts_increment);

        packet
    }
}

/// Resample 16kHz signed-linear samples to 8kHz by averaging pairs.
pub fn resample_16k_to_8k(samples: &[i16]) -> Vec<i16> {
    samples
        .chunks(2)
        .map(|pair| {
            let a = pair[0] as i32;
            let b = pair.get(1).map(|&v| v as i32).unwrap_or(a);
            ((a + b) / 2) as i16
        })
        .collect()
}

/// Encode a signed 16-bit linear sample to G.711 μ-law (8-bit).
/// Standard ITU-T G.711 encoding.
pub fn linear_to_ulaw(sample: i16) -> u8 {
    const BIAS: i32 = 0x84;
    const CLIP: i32 = 32635;

    let sign: u8 = if sample < 0 { 0x80 } else { 0 };
    let mut s = if sample < 0 {
        -(sample as i32)
    } else {
        sample as i32
    };
    if s > CLIP {
        s = CLIP;
    }
    s += BIAS;

    let exponent = ULAW_EXPONENT_TABLE[((s >> 7) & 0xFF) as usize];
    let mantissa = (s >> (exponent + 3)) & 0x0F;

    !(sign | (exponent << 4) | mantissa as u8)
}

/// Encode a buffer of i16 samples to G.711 μ-law bytes.
pub fn encode_ulaw(samples: &[i16]) -> Vec<u8> {
    samples.iter().map(|&s| linear_to_ulaw(s)).collect()
}

/// Exponent lookup table for μ-law encoding.
static ULAW_EXPONENT_TABLE: [u8; 256] = [
    0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3,
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ulaw_builder_basic() {
        let mut builder = RtpBuilder::new_ulaw();
        let payload = vec![0xFF; 80]; // 80 bytes = 10ms at 8kHz ulaw
        let pkt = builder.build_packet_raw(&payload);

        assert_eq!(pkt.len(), 12 + 80);
        assert_eq!(pkt[0], 0x80); // V=2
        assert_eq!(pkt[1], 0);    // PT=0 (PCMU)
        // Payload unchanged
        assert_eq!(pkt[12], 0xFF);
    }

    #[test]
    fn resample_basic() {
        let samples_16k = vec![100i16, 200, 300, 400];
        let samples_8k = resample_16k_to_8k(&samples_16k);
        assert_eq!(samples_8k.len(), 2);
        assert_eq!(samples_8k[0], 150); // (100+200)/2
        assert_eq!(samples_8k[1], 350); // (300+400)/2
    }

    #[test]
    fn ulaw_encode_silence() {
        // Silence (0) should encode to ~0xFF in μ-law
        let result = linear_to_ulaw(0);
        assert_eq!(result, 0xFF);
    }

    #[test]
    fn slin16_builder_be_swap() {
        let mut builder = RtpBuilder {
            sequence: 100,
            timestamp: 1000,
            ssrc: 0xDEADBEEF,
            payload_type: 118,
            ts_increment: 320,
        };

        let pcm_le = vec![0x01, 0x02, 0x03, 0x04];
        let pkt = builder.build_packet(&pcm_le);

        assert_eq!(pkt.len(), 12 + 4);
        // Payload: LE → BE swap
        assert_eq!(pkt[12], 0x02);
        assert_eq!(pkt[13], 0x01);
        assert_eq!(pkt[14], 0x04);
        assert_eq!(pkt[15], 0x03);
    }
}
