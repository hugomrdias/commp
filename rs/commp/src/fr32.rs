//! FR32 padding: 127 payload bytes (a quad) become 4 field elements of 254
//! bits, stored in 128 bytes

use crate::{IN_BYTES_PER_QUAD, OUT_BYTES_PER_QUAD};

/// FR32 pad a 127-byte quad into a 128-byte output buffer
/// 
/// FR32 inserts 2 zero bits every 254 bits (31.75 bytes).
#[inline(always)]
pub fn fr32_pad(source: &[u8], output: &mut [u8; OUT_BYTES_PER_QUAD]) {
    // First Fr element (bytes 0-31): copy directly, clear top 2 bits
    output[..32].copy_from_slice(&source[..32]);
    output[31] &= 0b00111111;

    // Second Fr element (bytes 32-63): shift left by 2 bits
    for i in 32..64 {
        output[i] = (source[i] << 2) | (source[i - 1] >> 6);
    }
    output[63] &= 0b00111111;

    // Third Fr element (bytes 64-95): shift left by 4 bits
    for i in 64..96 {
        output[i] = (source[i] << 4) | (source[i - 1] >> 4);
    }
    output[95] &= 0b00111111;

    // Fourth Fr element (bytes 96-127): shift left by 6 bits
    for i in 96..127 {
        output[i] = (source[i] << 6) | (source[i - 1] >> 2);
    }
    // Last byte: just the top 6 bits of source[126] shifted right
    output[127] = source[126] >> 2;
}

/// Zero padding needed to round a payload up to a power-of-two number of quads
///
/// Matches `Unpadded.toPadding` in data-segment and `unpaddedToPadding` in
/// synapse-core. Computed in `u64` so it can't overflow on wasm32.
#[inline]
pub fn zero_padding(payload_size: u64) -> u64 {
    let quads = payload_size
        .div_ceil(IN_BYTES_PER_QUAD as u64)
        .max(1)
        .next_power_of_two();
    quads * IN_BYTES_PER_QUAD as u64 - payload_size
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fr32_pad() {
        let input = [0x42u8; IN_BYTES_PER_QUAD];
        let mut output = [0u8; OUT_BYTES_PER_QUAD];
        fr32_pad(&input, &mut output);
        
        assert_eq!(output.len(), 128);
        assert_eq!(output[31] & 0b11000000, 0);
        assert_eq!(output[63] & 0b11000000, 0);
        assert_eq!(output[95] & 0b11000000, 0);
    }

    #[test]
    fn test_zero_padding() {
        assert_eq!(zero_padding(0), 127);
        assert_eq!(zero_padding(1), 126);
        assert_eq!(zero_padding(65), 62);
        assert_eq!(zero_padding(127), 0);
        assert_eq!(zero_padding(128), 126);
        assert_eq!(zero_padding(1024), 1008);
        assert_eq!(zero_padding(1024 * 1024), 1032192);
        // Overflowed usize on wasm32 before (#5)
        assert_eq!(zero_padding(33_292_288), 0);
        assert_eq!(zero_padding(33_292_289), 33_292_287);
        assert_eq!(zero_padding(40_000_000), 26_584_576);
        // Beyond 2^32
        assert_eq!(zero_padding(127 << 32), 0);
        assert_eq!(zero_padding((127 << 32) + 1), (127 << 32) - 1);
        assert_eq!(zero_padding(1 << 35), (127 << 29) - (1 << 35));
    }
}
