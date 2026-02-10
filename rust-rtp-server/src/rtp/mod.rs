pub mod listener;

/// Minimum RTP header size (no CSRC, no extensions)
pub const RTP_HEADER_MIN: usize = 12;

/// Zero-copy RTP packet parser.
///
/// RTP Header Format (RFC 3550):
/// ```text
///  0                   1                   2                   3
///  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
/// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
/// |V=2|P|X|  CC   |M|     PT      |       sequence number         |
/// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
/// |                           timestamp                           |
/// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
/// |           synchronization source (SSRC) identifier            |
/// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
/// ```
pub struct RtpPacket<'a> {
    data: &'a [u8],
}

impl<'a> RtpPacket<'a> {
    /// Parse an RTP packet from raw bytes. Returns None if invalid.
    pub fn parse(data: &'a [u8]) -> Option<Self> {
        if data.len() < RTP_HEADER_MIN {
            return None;
        }
        // Version must be 2
        if (data[0] >> 6) != 2 {
            return None;
        }
        Some(Self { data })
    }

    /// Payload type (7 bits)
    pub fn payload_type(&self) -> u8 {
        self.data[1] & 0x7F
    }

    /// Sequence number (16 bits)
    pub fn sequence_number(&self) -> u16 {
        u16::from_be_bytes([self.data[2], self.data[3]])
    }

    /// Timestamp (32 bits)
    pub fn timestamp(&self) -> u32 {
        u32::from_be_bytes([self.data[4], self.data[5], self.data[6], self.data[7]])
    }

    /// Synchronization source identifier (32 bits)
    pub fn ssrc(&self) -> u32 {
        u32::from_be_bytes([self.data[8], self.data[9], self.data[10], self.data[11]])
    }

    /// Number of CSRC identifiers (4 bits)
    pub fn csrc_count(&self) -> usize {
        (self.data[0] & 0x0F) as usize
    }

    /// Whether the extension bit is set
    pub fn has_extension(&self) -> bool {
        (self.data[0] & 0x10) != 0
    }

    /// Whether the padding bit is set
    pub fn has_padding(&self) -> bool {
        (self.data[0] & 0x20) != 0
    }

    /// Marker bit
    pub fn marker(&self) -> bool {
        (self.data[1] & 0x80) != 0
    }

    /// Total header size including CSRC and extensions
    fn header_size(&self) -> usize {
        let mut size = RTP_HEADER_MIN + self.csrc_count() * 4;

        if self.has_extension() && self.data.len() >= size + 4 {
            // Extension header: 2 bytes profile-specific, 2 bytes length (32-bit words)
            let ext_words =
                u16::from_be_bytes([self.data[size + 2], self.data[size + 3]]) as usize;
            size += 4 + ext_words * 4;
        }

        size
    }

    /// Audio payload (zero-copy slice into original buffer)
    pub fn payload(&self) -> &'a [u8] {
        let start = self.header_size();
        let end = if self.has_padding() && !self.data.is_empty() {
            let pad_len = self.data[self.data.len() - 1] as usize;
            self.data.len().saturating_sub(pad_len)
        } else {
            self.data.len()
        };

        if start >= end || start >= self.data.len() {
            return &[];
        }
        &self.data[start..end]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_rtp() {
        // Version 2, no padding, no extension, CC=0, PT=0 (PCMU), seq=1, ts=160, ssrc=12345
        // Then 4 bytes of payload
        let mut pkt = vec![
            0x80, 0x00, // V=2, P=0, X=0, CC=0, M=0, PT=0
            0x00, 0x01, // seq=1
            0x00, 0x00, 0x00, 0xA0, // ts=160
            0x00, 0x00, 0x30, 0x39, // ssrc=12345
            0xDE, 0xAD, 0xBE, 0xEF, // payload
        ];

        let rtp = RtpPacket::parse(&pkt).unwrap();
        assert_eq!(rtp.payload_type(), 0);
        assert_eq!(rtp.sequence_number(), 1);
        assert_eq!(rtp.timestamp(), 160);
        assert_eq!(rtp.ssrc(), 12345);
        assert_eq!(rtp.payload(), &[0xDE, 0xAD, 0xBE, 0xEF]);

        // Invalid: too short
        assert!(RtpPacket::parse(&pkt[..8]).is_none());

        // Invalid: wrong version
        pkt[0] = 0x00; // version 0
        assert!(RtpPacket::parse(&pkt).is_none());
    }

    #[test]
    fn parse_rtp_with_padding() {
        let pkt = vec![
            0xA0, 0x00, // V=2, P=1, X=0, CC=0
            0x00, 0x01, 0x00, 0x00, 0x00, 0xA0, 0x00, 0x00, 0x30, 0x39,
            0xAA, 0xBB, // payload
            0x00, 0x02, // padding (2 bytes, last byte = pad length)
        ];

        let rtp = RtpPacket::parse(&pkt).unwrap();
        assert!(rtp.has_padding());
        assert_eq!(rtp.payload(), &[0xAA, 0xBB]);
    }
}
