//! FR32 padding: 127 payload bytes (a quad) become 4 field elements of 254
//! bits, stored in 128 bytes

use crate::{IN_BYTES_PER_QUAD, OUT_BYTES_PER_QUAD};

/// Clears the top 2 bits of a little-endian `u64`, the last 2 bits of an Fr
const LIMB_MASK: u64 = u64::MAX >> 2;

/// FR32 pad a 127-byte quad into a 128-byte output buffer
///
/// FR32 inserts 2 zero bits every 254 bits (31.75 bytes): Fr element `k`
/// is the source shifted left by `2k` bits, its top 2 bits cleared.
///
/// Works on the quad as 16 little-endian `u64`s, so each shift moves 64
/// bits at once and the carry from the byte below comes from the limb
/// below. ~7x faster than shifting byte by byte, and LLVM vectorizes it.
#[inline(always)]
pub fn fr32_pad(source: &[u8], output: &mut [u8; OUT_BYTES_PER_QUAD]) {
    let source: &[u8; IN_BYTES_PER_QUAD] = source[..IN_BYTES_PER_QUAD].try_into().unwrap();
    // The 128th source byte is past the quad: zero, so the last output
    // byte is only the top 6 bits of source[126]
    let mut limbs = [0u64; 16];
    for (limb, bytes) in limbs.iter_mut().zip(source.chunks_exact(8)) {
        *limb = u64::from_le_bytes(bytes.try_into().unwrap());
    }
    let mut last = [0u8; 8];
    last[..7].copy_from_slice(&source[120..]);
    limbs[15] = u64::from_le_bytes(last);

    let mut out = [0u64; 16];
    out[..4].copy_from_slice(&limbs[..4]);
    out[3] &= LIMB_MASK;
    for k in 1..4 {
        let shift = 2 * k as u32;
        for i in 4 * k..4 * k + 4 {
            out[i] = (limbs[i] << shift) | (limbs[i - 1] >> (64 - shift));
        }
        out[4 * k + 3] &= LIMB_MASK;
    }

    for (bytes, limb) in output.chunks_exact_mut(8).zip(out) {
        bytes.copy_from_slice(&limb.to_le_bytes());
    }
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

    /// The FR32 definition, shifting byte by byte
    fn fr32_pad_bytes(source: &[u8], output: &mut [u8; OUT_BYTES_PER_QUAD]) {
        output[..32].copy_from_slice(&source[..32]);
        output[31] &= 0b00111111;
        for i in 32..64 {
            output[i] = (source[i] << 2) | (source[i - 1] >> 6);
        }
        output[63] &= 0b00111111;
        for i in 64..96 {
            output[i] = (source[i] << 4) | (source[i - 1] >> 4);
        }
        output[95] &= 0b00111111;
        for i in 96..127 {
            output[i] = (source[i] << 6) | (source[i - 1] >> 2);
        }
        output[127] = source[126] >> 2;
    }

    #[test]
    fn test_fr32_pad_matches_bytes() {
        let mut state = 0x9e3779b97f4a7c15u64;
        let mut quads: Vec<[u8; IN_BYTES_PER_QUAD]> = vec![[0x00; IN_BYTES_PER_QUAD], [0xff; IN_BYTES_PER_QUAD]];
        for _ in 0..1000 {
            quads.push(core::array::from_fn(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                state as u8
            }));
        }
        // Each single set bit, to check every carry
        for bit in 0..IN_BYTES_PER_QUAD * 8 {
            let mut quad = [0u8; IN_BYTES_PER_QUAD];
            quad[bit / 8] = 1 << (bit % 8);
            quads.push(quad);
        }
        for quad in &quads {
            let (mut expected, mut actual) = ([0u8; OUT_BYTES_PER_QUAD], [0u8; OUT_BYTES_PER_QUAD]);
            fr32_pad_bytes(quad, &mut expected);
            fr32_pad(quad, &mut actual);
            assert_eq!(actual, expected);
        }
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
