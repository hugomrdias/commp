//! Multihash encoding of the piece digest

use crate::NODE_SIZE;
use alloc::vec::Vec;

/// Encode the multihash: [code, digest size, padding, height, root]
pub fn encode_digest(padding: u64, height: u8, root: &[u8; NODE_SIZE]) -> Vec<u8> {
    let mut result = Vec::with_capacity(48);

    // Write code (0x1011)
    varint_encode(0x1011, &mut result);

    // Digest size: padding varint + height byte + root
    let digest_size = varint_len(padding) + 1 + NODE_SIZE as u64;
    varint_encode(digest_size, &mut result);

    varint_encode(padding, &mut result);
    result.push(height);
    result.extend_from_slice(root);

    result
}

/// Encode a number as varint
#[inline]
fn varint_encode(mut num: u64, out: &mut Vec<u8>) {
    while num >= 0x80 {
        out.push((num as u8 & 0x7f) | 0x80);
        num >>= 7;
    }
    out.push(num as u8);
}

/// Get varint encoding length
#[inline]
fn varint_len(mut num: u64) -> u64 {
    let mut len = 1;
    while num >= 0x80 {
        len += 1;
        num >>= 7;
    }
    len
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_varint_u64() {
        let mut out = Vec::new();
        varint_encode((1 << 33) + 5, &mut out);
        assert_eq!(out, [0x85, 0x80, 0x80, 0x80, 0x20]);
        assert_eq!(varint_len((1 << 33) + 5), 5);
    }
}
