//! Fast CommP (Filecoin Piece Commitment) WASM implementation
//!
//! Optimized for maximum throughput with:
//! - Fused FR32 padding and hashing
//! - Zero-copy buffer management
//! - Integer-only size calculations
//! - Inline assembly hints for hot paths

use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

/// Size of a merkle tree node (32 bytes)
const NODE_SIZE: usize = 32;

/// Input bytes per quad (127 bytes = 4 * 254 bits / 8)
const IN_BYTES_PER_QUAD: usize = 127;

/// Output bytes per quad after FR32 padding (128 bytes)
const OUT_BYTES_PER_QUAD: usize = 128;

/// Maximum tree levels
const MAX_LEVEL: usize = 64;

/// Pre-computed zero commitment nodes for each level (lazily initialized)
fn get_zero_comm(level: usize) -> [u8; NODE_SIZE] {
    static ZERO_COMMS: std::sync::OnceLock<[[u8; NODE_SIZE]; MAX_LEVEL]> = std::sync::OnceLock::new();
    
    ZERO_COMMS.get_or_init(|| {
        let mut comms = [[0u8; NODE_SIZE]; MAX_LEVEL];
        let mut concat = [0u8; NODE_SIZE * 2];
        
        for i in 1..MAX_LEVEL {
            concat[..NODE_SIZE].copy_from_slice(&comms[i - 1]);
            concat[NODE_SIZE..].copy_from_slice(&comms[i - 1]);
            comms[i] = truncated_hash_64(&concat);
        }
        comms
    })[level]
}

/// Compute truncated SHA256 hash for 64-byte input (optimized path)
#[inline(always)]
fn truncated_hash_64(data: &[u8; 64]) -> [u8; NODE_SIZE] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let mut result: [u8; NODE_SIZE] = hasher.finalize().into();
    result[NODE_SIZE - 1] &= 0b00111111;
    result
}

/// FR32 pad a 127-byte quad into a 128-byte output buffer
/// 
/// FR32 inserts 2 zero bits every 254 bits (31.75 bytes).
#[inline(always)]
fn fr32_pad(source: &[u8], output: &mut [u8; OUT_BYTES_PER_QUAD]) {
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

/// Process a 127-byte quad: FR32 pad and hash to produce 2 leaf nodes
/// Uses a single reusable buffer to avoid allocation
#[inline(always)]
fn process_quad_into(source: &[u8], padded: &mut [u8; OUT_BYTES_PER_QUAD]) -> ([u8; NODE_SIZE], [u8; NODE_SIZE]) {
    fr32_pad(source, padded);
    
    // Use fixed-size array references for optimized hash path
    // SAFETY: padded is exactly 128 bytes, so these conversions always succeed
    let first: &[u8; 64] = padded[..64].try_into().unwrap();
    let second: &[u8; 64] = padded[64..].try_into().unwrap();
    
    (truncated_hash_64(first), truncated_hash_64(second))
}

/// Compute parent node from two children using a pre-allocated buffer
#[inline(always)]
fn compute_node_into(left: &[u8; NODE_SIZE], right: &[u8; NODE_SIZE], concat: &mut [u8; 64]) -> [u8; NODE_SIZE] {
    concat[..NODE_SIZE].copy_from_slice(left);
    concat[NODE_SIZE..].copy_from_slice(right);
    truncated_hash_64(concat)
}

/// Zero padding needed to round a payload up to a power-of-two number of quads
///
/// Matches `Unpadded.toPadding` in data-segment and `unpaddedToPadding` in
/// synapse-core. Computed in `u64` so it can't overflow on wasm32.
#[inline]
fn zero_padding(payload_size: u64) -> u64 {
    let quads = payload_size
        .div_ceil(IN_BYTES_PER_QUAD as u64)
        .max(1)
        .next_power_of_two();
    quads * IN_BYTES_PER_QUAD as u64 - payload_size
}

/// Streaming CommP hasher with optimized memory management
#[wasm_bindgen]
pub struct CommPHasher {
    /// Buffer for accumulating partial quads
    buffer: [u8; IN_BYTES_PER_QUAD],
    /// Current offset into buffer
    offset: usize,
    /// Total bytes written
    bytes_written: u64,
    /// Collected leaf nodes
    leaves: Vec<[u8; NODE_SIZE]>,
    /// Reusable FR32 padding buffer (avoids allocation in hot loop)
    pad_buffer: [u8; OUT_BYTES_PER_QUAD],
}

#[wasm_bindgen]
impl CommPHasher {
    /// Create a new hasher
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        CommPHasher {
            buffer: [0u8; IN_BYTES_PER_QUAD],
            offset: 0,
            bytes_written: 0,
            leaves: Vec::with_capacity(16384), // Pre-allocate for ~1MB of input
            pad_buffer: [0u8; OUT_BYTES_PER_QUAD],
        }
    }

    /// Write bytes into the hasher
    pub fn write(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }

        let len = bytes.len();
        self.bytes_written += len as u64;

        // Fast path: if we can't complete a quad, just buffer
        if self.offset + len < IN_BYTES_PER_QUAD {
            self.buffer[self.offset..self.offset + len].copy_from_slice(bytes);
            self.offset += len;
            return;
        }

        let mut read_pos = 0;

        // Complete the buffered quad if we have partial data
        if self.offset > 0 {
            let bytes_needed = IN_BYTES_PER_QUAD - self.offset;
            self.buffer[self.offset..].copy_from_slice(&bytes[..bytes_needed]);
            read_pos = bytes_needed;

            let (leaf1, leaf2) = process_quad_into(&self.buffer, &mut self.pad_buffer);
            self.leaves.push(leaf1);
            self.leaves.push(leaf2);
            self.offset = 0;
        }

        // Process full quads directly from input
        while read_pos + IN_BYTES_PER_QUAD <= len {
            let (leaf1, leaf2) = process_quad_into(
                &bytes[read_pos..read_pos + IN_BYTES_PER_QUAD],
                &mut self.pad_buffer
            );
            self.leaves.push(leaf1);
            self.leaves.push(leaf2);
            read_pos += IN_BYTES_PER_QUAD;
        }

        // Buffer remaining bytes
        let remaining = len - read_pos;
        if remaining > 0 {
            self.buffer[..remaining].copy_from_slice(&bytes[read_pos..]);
            self.offset = remaining;
        }
    }

    /// Build final tree and return (height, root)
    ///
    /// Does not modify the hasher, so it can be called repeatedly and
    /// interleaved with `write()`.
    fn build(&self) -> (u8, [u8; NODE_SIZE]) {
        // Leaves for the buffered partial quad (or an all-zero quad for empty input)
        let mut tail = [[0u8; NODE_SIZE]; 2];
        let mut tail_len = 0;
        if self.offset > 0 || self.bytes_written == 0 {
            let mut buffer = self.buffer;
            buffer[self.offset..].fill(0);
            let mut padded = [0u8; OUT_BYTES_PER_QUAD];
            let (leaf1, leaf2) = process_quad_into(&buffer, &mut padded);
            tail = [leaf1, leaf2];
            tail_len = 2;
        }

        // Leaves always come in pairs and there is at least one quad, so the
        // leaf level is even and non-empty.
        let stored = self.leaves.len();
        let num_leaves = stored + tail_len;
        let leaf = |i: usize| if i < stored { &self.leaves[i] } else { &tail[i - stored] };

        let mut concat_buf = [0u8; 64];

        // Our leaves hash 64-byte halves of a quad, so they are level 1 of the
        // reference tree (level 0 is the raw 32-byte FR32 chunks).
        let mut current: Vec<[u8; NODE_SIZE]> = Vec::with_capacity(num_leaves / 2 + 1);
        let mut i = 0;
        while i < num_leaves {
            current.push(compute_node_into(leaf(i), leaf(i + 1), &mut concat_buf));
            i += 2;
        }
        let mut height: u8 = 2;
        let mut next: Vec<[u8; NODE_SIZE]> = Vec::with_capacity(current.len() / 2 + 1);

        while current.len() > 1 {
            // Pad with zero commitment if odd number
            if current.len() % 2 == 1 {
                current.push(get_zero_comm(height as usize));
            }

            // Combine pairs into parent nodes
            next.clear();
            let mut i = 0;
            while i < current.len() {
                next.push(compute_node_into(&current[i], &current[i + 1], &mut concat_buf));
                i += 2;
            }

            // Swap buffers
            std::mem::swap(&mut current, &mut next);
            height += 1;
        }

        (height, current[0])
    }

    /// Get the full multihash-encoded digest
    /// 
    /// Returns: [code (varint 0x1011), size (varint), padding (varint), height (u8), root (32 bytes)]
    /// 
    /// - `code`: 0x1011 = "fr32-sha256-trunc254-padded-binary-tree" multihash identifier
    /// - `size`: total digest size (padding_len + 1 + 32)
    /// - `padding`: bytes of zero-padding added to reach next power-of-two piece size  
    /// - `height`: tree height (log2 of leaf count)
    /// - `root`: 32-byte Merkle root
    pub fn digest(&self) -> Vec<u8> {
        let (height, root) = self.build();
        encode_digest(zero_padding(self.bytes_written), height, &root)
    }

    /// Get just the 32-byte CommP root hash
    /// 
    /// Returns the raw Merkle root without multihash encoding.
    /// Use `digest()` if you need the full multihash with metadata.
    pub fn root(&self) -> Vec<u8> {
        let (_, root) = self.build();
        root.to_vec()
    }

    /// Get the tree height
    pub fn height(&self) -> u8 {
        let (height, _) = self.build();
        height
    }

    /// Get bytes written count
    pub fn count(&self) -> u64 {
        self.bytes_written
    }

    /// Reset the hasher for reuse
    pub fn reset(&mut self) {
        self.buffer.fill(0);
        self.offset = 0;
        self.bytes_written = 0;
        self.leaves.clear();
    }
}

impl Default for CommPHasher {
    fn default() -> Self {
        Self::new()
    }
}

/// Encode the multihash: [code, digest size, padding, height, root]
fn encode_digest(padding: u64, height: u8, root: &[u8; NODE_SIZE]) -> Vec<u8> {
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

/// One-shot digest: returns full multihash-encoded CommP
/// 
/// Format: [code (varint 0x1011), size (varint), padding (varint), height (u8), root (32 bytes)]
/// 
/// Use this when you need the complete Filecoin piece commitment with metadata.
/// The multihash code 0x1011 identifies this as "fr32-sha256-trunc254-padded-binary-tree".
#[wasm_bindgen]
pub fn digest(data: &[u8]) -> Vec<u8> {
    let mut hasher = CommPHasher::new();
    hasher.write(data);
    hasher.digest()
}

/// One-shot root: returns just the 32-byte CommP root hash
/// 
/// Use this when you only need the raw hash without multihash encoding.
/// This is the Merkle root of the FR32-padded, SHA256-hashed binary tree.
#[wasm_bindgen]
pub fn root(data: &[u8]) -> Vec<u8> {
    let mut hasher = CommPHasher::new();
    hasher.write(data);
    hasher.root()
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
    fn test_truncated_hash() {
        let data = [0u8; 64];
        let hash = truncated_hash_64(&data);
        assert_eq!(hash[31] & 0b11000000, 0);
    }

    #[test]
    fn test_hasher_basic() {
        let mut hasher = CommPHasher::new();
        hasher.write(&[0x42u8; 127]);
        let root = hasher.root();
        assert_eq!(root.len(), 32);
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

    #[test]
    fn test_varint_u64() {
        let mut out = Vec::new();
        varint_encode((1 << 33) + 5, &mut out);
        assert_eq!(out, [0x85, 0x80, 0x80, 0x80, 0x20]);
        assert_eq!(varint_len((1 << 33) + 5), 5);
    }

    #[test]
    fn test_height() {
        // One quad is 4 FR32 chunks: height 2 (#2)
        let mut hasher = CommPHasher::new();
        assert_eq!(hasher.height(), 2);
        hasher.write(&[0x42u8; 127]);
        assert_eq!(hasher.height(), 2);
        hasher.write(&[0x42u8; 1]);
        assert_eq!(hasher.height(), 3);
    }

    #[test]
    fn test_empty_digest() {
        // padding 127, height 2 (#4)
        let digest = CommPHasher::new().digest();
        assert_eq!(&digest[..5], &[0x91, 0x20, 0x22, 0x7f, 0x02]);
    }

    #[test]
    fn test_build_is_repeatable() {
        let mut hasher = CommPHasher::new();
        hasher.write(&[0x42u8; 1000]);
        let first = hasher.digest();
        assert_eq!(hasher.digest(), first);
        assert_eq!(hasher.root(), first[first.len() - 32..]);
        assert_eq!(hasher.height(), first[first.len() - 33]);

        // Writing after digest matches a single write
        hasher.write(&[0x43u8; 1000]);
        let mut expected = CommPHasher::new();
        expected.write(&[0x42u8; 1000]);
        expected.write(&[0x43u8; 1000]);
        assert_eq!(hasher.digest(), expected.digest());
    }
}
