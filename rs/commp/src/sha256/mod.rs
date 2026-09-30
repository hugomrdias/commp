//! SHA-256 of 64-byte messages, truncated to 254 bits
//!
//! Every leaf and every tree node is the hash of one 64-byte message, and all
//! of them on one tree level are independent, so [`hash_many`] hashes several
//! at once with the fastest code for the target (see `backend` on native,
//! `wasm` on wasm32).

use crate::NODE_SIZE;

#[cfg(target_arch = "aarch64")]
mod arm;
#[cfg(not(target_arch = "wasm32"))]
mod backend;
#[cfg(any(target_arch = "aarch64", target_arch = "x86_64"))]
mod lanes;
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
mod wasm;
#[cfg(target_arch = "x86_64")]
mod x86;

#[cfg(not(target_arch = "wasm32"))]
pub use backend::{hash_many, sha256_backend};
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
pub use wasm::hash_many;

#[cfg(all(target_arch = "wasm32", not(target_feature = "simd128")))]
pub use hash_many_portable as hash_many;

/// SHA-256 initial state
const IV: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/// SHA-256 round constants
#[allow(dead_code)] // where only the portable code runs
const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/// `K[i] + W[i]` for the padding block of a 64-byte message, which is
/// always the same: `0x80`, zeros, then the bit length 512
#[allow(dead_code)] // where only the portable code runs
const PAD_KW: [u32; 64] = {
    let mut w = [0u32; 64];
    w[0] = 0x8000_0000;
    w[15] = 512;
    let mut i = 16;
    while i < 64 {
        let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
        let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        i += 1;
    }
    let mut kw = [0u32; 64];
    let mut i = 0;
    while i < 64 {
        kw[i] = K[i].wrapping_add(w[i]);
        i += 1;
    }
    kw
};

/// Padding block of a 64-byte message: `0x80`, zeros, then the bit length 512
const PAD_BLOCK: [u8; 64] = {
    let mut block = [0u8; 64];
    block[0] = 0x80;
    block[62] = 0x02;
    block
};

/// Compute truncated SHA256 hash for 64-byte input
///
/// Calls the raw compression function directly: the input is always one
/// block, so `Digest`'s buffering and padding logic is dead weight.
#[inline(never)]
pub fn truncated_hash_64(data: &[u8; 64]) -> [u8; NODE_SIZE] {
    let mut state = IV;
    sha2::block_api::compress256(&mut state, &[*data, PAD_BLOCK]);
    let mut result = [0u8; NODE_SIZE];
    for (bytes, word) in result.chunks_exact_mut(4).zip(state) {
        bytes.copy_from_slice(&word.to_be_bytes());
    }
    result[NODE_SIZE - 1] &= 0b00111111;
    result
}

/// Hash many 64-byte messages into truncated nodes, one at a time
#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
pub fn hash_many_portable(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    for (msg, node) in msgs.iter().zip(out.iter_mut()) {
        *node = truncated_hash_64(msg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncated_hash() {
        let data = [0u8; 64];
        let hash = truncated_hash_64(&data);
        assert_eq!(hash[31] & 0b11000000, 0);
    }
}
