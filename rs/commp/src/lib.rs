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

/// Minimum payload size (65 bytes)
const MIN_PAYLOAD_SIZE: usize = 65;

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

/// Calculate zero-padded size for a payload using integer math only
/// 
/// This replaces the floating-point calculation with pure integer operations
/// for better performance and determinism.
#[inline]
fn to_zero_padded_size(payload_size: usize) -> usize {
    let size = payload_size.max(MIN_PAYLOAD_SIZE);
    
    // Find highest set bit (equivalent to floor(log2(size)))
    let highest_bit = (usize::BITS - size.leading_zeros() - 1) as usize;
    
    // FR_RATIO = 254/256 ≈ 0.9921875
    // bound = ceil(254/256 * 2^(highest_bit + 1))
    //       = ceil(254 * 2^highest_bit / 128)
    //       = (254 * 2^highest_bit + 127) / 128  (integer ceil)
    let power = 1usize << highest_bit;
    let bound = (254 * power + 127) / 128;
    
    if size <= bound {
        bound
    } else {
        // bound2 = ceil(254/256 * 2^(highest_bit + 2))
        (254 * power * 2 + 127) / 128
    }
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
    /// Uses in-place buffer swapping to avoid allocations during tree building.
    fn build(&mut self) -> (u8, [u8; NODE_SIZE]) {
        // Process any remaining buffered data
        if self.offset > 0 || self.bytes_written == 0 {
            // Zero-fill the rest of the buffer
            self.buffer[self.offset..].fill(0);
            let (leaf1, leaf2) = process_quad_into(&self.buffer, &mut self.pad_buffer);
            self.leaves.push(leaf1);
            self.leaves.push(leaf2);
        }

        let num_leaves = self.leaves.len();
        if num_leaves == 0 {
            return (0, [0u8; NODE_SIZE]);
        }

        // Build tree level by level using double-buffering
        let mut current = std::mem::take(&mut self.leaves);
        let mut next: Vec<[u8; NODE_SIZE]> = Vec::with_capacity(num_leaves / 2 + 1);
        let mut concat_buf = [0u8; 64];
        let mut height: u8 = 0;
        
        while current.len() > 1 {
            // Pad with zero commitment if odd number
            if current.len() % 2 == 1 {
                current.push(get_zero_comm(height as usize + 1));
            }
            
            // Combine pairs into parent nodes
            next.clear();
            next.reserve(current.len() / 2);
            
            let mut i = 0;
            while i < current.len() {
                let parent = compute_node_into(&current[i], &current[i + 1], &mut concat_buf);
                next.push(parent);
                i += 2;
            }
            
            // Swap buffers
            std::mem::swap(&mut current, &mut next);
            height += 1;
        }

        let root = if current.is_empty() {
            [0u8; NODE_SIZE]
        } else {
            current[0]
        };

        // Restore leaves vector for potential reuse
        self.leaves = current;
        self.leaves.clear();

        (height, root)
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
    pub fn digest(&mut self) -> Vec<u8> {
        let (height, root) = self.build();
        
        let padding = if self.bytes_written == 0 {
            MIN_PAYLOAD_SIZE
        } else {
            to_zero_padded_size(self.bytes_written as usize) - self.bytes_written as usize
        };

        // Build result: multihash format
        let mut result = Vec::with_capacity(48);
        
        // Write code (0x1011)
        varint_encode(0x1011, &mut result);
        
        // Calculate digest size
        let padding_len = varint_len(padding);
        let digest_size = padding_len + 1 + NODE_SIZE;
        varint_encode(digest_size, &mut result);
        
        // Write padding
        varint_encode(padding, &mut result);
        
        // Write height
        result.push(height);
        
        // Write root
        result.extend_from_slice(&root);
        
        result
    }

    /// Get just the 32-byte CommP root hash
    /// 
    /// Returns the raw Merkle root without multihash encoding.
    /// Use `digest()` if you need the full multihash with metadata.
    pub fn root(&mut self) -> Vec<u8> {
        let (_, root) = self.build();
        root.to_vec()
    }

    /// Get the tree height
    pub fn height(&mut self) -> u8 {
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

/// Encode a number as varint
#[inline]
fn varint_encode(mut num: usize, out: &mut Vec<u8>) {
    while num >= 0x80 {
        out.push((num as u8 & 0x7f) | 0x80);
        num >>= 7;
    }
    out.push(num as u8);
}

/// Get varint encoding length
#[inline]
fn varint_len(mut num: usize) -> usize {
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
    fn test_zero_padded_size() {
        // Test that integer math matches JS implementation
        assert_eq!(to_zero_padded_size(65), 127);
        assert_eq!(to_zero_padded_size(127), 127);
        assert_eq!(to_zero_padded_size(128), 254);
        assert_eq!(to_zero_padded_size(1024), 2032);
        assert_eq!(to_zero_padded_size(1024 * 1024), 2080768);
    }
}
