//! Streaming CommP hasher

use crate::fr32::{fr32_pad, zero_padding};
use crate::multihash::encode_digest;
use crate::sha256::hash_many;
use crate::tree::{reduce, Stack};
use crate::{
    BATCH_LEAVES, BATCH_LEVEL, BATCH_QUADS, IN_BYTES_PER_QUAD, MAX_PAYLOAD_SIZE, NODE_SIZE, OUT_BYTES_PER_QUAD,
};
use alloc::{string::String, vec::Vec};
use wasm_bindgen::prelude::*;

/// Payload bytes in a full batch
#[cfg(all(feature = "parallel", not(target_arch = "wasm32")))]
const BATCH_BYTES: usize = BATCH_QUADS * IN_BYTES_PER_QUAD;

/// Smallest run of full batches in one `write()` worth spreading over threads
#[cfg(all(feature = "parallel", not(target_arch = "wasm32")))]
const PARALLEL_MIN_BATCHES: usize = 4;

/// Most batches hashed in parallel at once (~4 MiB of payload), so the roots
/// waiting to be folded in order take a fixed 8 KiB whatever the write size
#[cfg(all(feature = "parallel", not(target_arch = "wasm32")))]
const PARALLEL_GROUP: usize = 256;

#[wasm_bindgen]
extern "C" {
    /// JS `RangeError`, thrown when a write would exceed `MAX_PAYLOAD_SIZE`
    #[wasm_bindgen(js_name = RangeError)]
    type RangeError;

    #[wasm_bindgen(constructor, js_class = "RangeError")]
    fn new(message: &str) -> RangeError;
}

/// Whether writing `len` more bytes would exceed `MAX_PAYLOAD_SIZE`
#[inline]
fn exceeds_max_payload(bytes_written: u64, len: usize) -> bool {
    bytes_written.saturating_add(len as u64) > MAX_PAYLOAD_SIZE
}

/// Error message matching data-segment's
///
/// Built by hand because `format!` pulls ~2.3 KB of `core::fmt` into the WASM.
fn max_payload_message(len: usize) -> String {
    fn push_decimal(out: &mut String, mut n: u64) {
        let mut digits = [0u8; 20];
        let mut i = digits.len();
        loop {
            i -= 1;
            digits[i] = b'0' + (n % 10) as u8;
            n /= 10;
            if n == 0 {
                break;
            }
        }
        for &digit in &digits[i..] {
            out.push(digit as char);
        }
    }

    let mut message = String::from("Writing ");
    push_decimal(&mut message, len as u64);
    message.push_str(" bytes exceeds max payload size of ");
    push_decimal(&mut message, MAX_PAYLOAD_SIZE);
    message
}

/// Root of the subtree over one full batch of FR32-padded quads
#[inline(always)]
fn batch_root(quads: &[[u8; OUT_BYTES_PER_QUAD]]) -> [u8; NODE_SIZE] {
    debug_assert_eq!(quads.len(), BATCH_QUADS);
    let mut nodes = [[0u8; NODE_SIZE]; BATCH_LEAVES];
    hash_many(as_messages(quads), &mut nodes);
    reduce(&mut nodes, BATCH_LEAVES, 1, BATCH_LEVEL);
    nodes[0]
}

/// View FR32-padded quads as their 64-byte halves (one message per leaf)
#[inline(always)]
fn as_messages(quads: &[[u8; OUT_BYTES_PER_QUAD]]) -> &[[u8; 64]] {
    // SAFETY: [u8; 128] and [[u8; 64]; 2] have the same size and alignment (1)
    unsafe { core::slice::from_raw_parts(quads.as_ptr() as *const [u8; 64], quads.len() * 2) }
}

/// Streaming CommP hasher with O(log n) memory
#[wasm_bindgen]
pub struct CommPHasher {
    /// Buffer for accumulating partial quads
    buffer: [u8; IN_BYTES_PER_QUAD],
    /// Current offset into buffer
    offset: usize,
    /// Total bytes written
    bytes_written: u64,
    /// FR32-padded quads waiting to be hashed as one batch. Allocated on the
    /// first full quad, so small inputs and new hashers stay cheap.
    batch: Vec<[u8; OUT_BYTES_PER_QUAD]>,
    /// Pending tree nodes; full batches enter at `BATCH_LEVEL`
    stack: Stack,
    /// Reusable buffer for hashing node pairs
    concat_buffer: [u8; 64],
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
            batch: Vec::new(),
            stack: Stack::new(),
            concat_buffer: [0u8; 64],
        }
    }

    /// FR32 pad a full quad into the batch, flushing it when full
    #[inline]
    fn push_quad(&mut self, quad: &[u8]) {
        if self.batch.capacity() == 0 {
            self.batch.reserve_exact(BATCH_QUADS);
        }
        let mut padded = [0u8; OUT_BYTES_PER_QUAD];
        fr32_pad(quad, &mut padded);
        self.batch.push(padded);
        if self.batch.len() == BATCH_QUADS {
            self.flush_batch();
        }
    }

    /// Hash a full batch into one subtree root and push it onto the stack
    fn flush_batch(&mut self) {
        let root = batch_root(&self.batch);
        self.stack.push_at(root, BATCH_LEVEL, &mut self.concat_buffer);
        self.batch.clear();
    }

    /// Hash up to `PARALLEL_GROUP` full batches at the start of `input` on
    /// all cores and push their roots in order; returns the bytes consumed
    #[cfg(all(feature = "parallel", not(target_arch = "wasm32")))]
    fn push_batches_parallel(&mut self, input: &[u8]) -> usize {
        use rayon::prelude::*;

        debug_assert!(self.batch.is_empty());
        let count = (input.len() / BATCH_BYTES).min(PARALLEL_GROUP);
        let mut roots = [[0u8; NODE_SIZE]; PARALLEL_GROUP];
        roots[..count]
            .par_iter_mut()
            .zip(input[..count * BATCH_BYTES].par_chunks_exact(BATCH_BYTES))
            .for_each(|(root, batch)| {
                let mut padded = [[0u8; OUT_BYTES_PER_QUAD]; BATCH_QUADS];
                for (quad, out) in batch.chunks_exact(IN_BYTES_PER_QUAD).zip(&mut padded) {
                    fr32_pad(quad, out);
                }
                *root = batch_root(&padded);
            });
        for &root in &roots[..count] {
            self.stack.push_at(root, BATCH_LEVEL, &mut self.concat_buffer);
        }
        count * BATCH_BYTES
    }

    /// Write bytes into the hasher
    ///
    /// Throws a `RangeError` (without changing the hasher) if the total would
    /// exceed `MAX_PAYLOAD_SIZE`.
    pub fn write(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        let len = bytes.len();
        if exceeds_max_payload(self.bytes_written, len) {
            return Err(RangeError::new(&max_payload_message(len)).into());
        }
        if len == 0 {
            return Ok(());
        }

        self.bytes_written += len as u64;

        // Fast path: if we can't complete a quad, just buffer
        if self.offset + len < IN_BYTES_PER_QUAD {
            self.buffer[self.offset..self.offset + len].copy_from_slice(bytes);
            self.offset += len;
            return Ok(());
        }

        let mut read_pos = 0;

        // Complete the buffered quad if we have partial data
        if self.offset > 0 {
            let bytes_needed = IN_BYTES_PER_QUAD - self.offset;
            self.buffer[self.offset..].copy_from_slice(&bytes[..bytes_needed]);
            read_pos = bytes_needed;

            let buffer = self.buffer;
            self.push_quad(&buffer);
            self.offset = 0;
        }

        // Process full quads directly from input
        while read_pos + IN_BYTES_PER_QUAD <= len {
            #[cfg(all(feature = "parallel", not(target_arch = "wasm32")))]
            if self.batch.is_empty() && len - read_pos >= PARALLEL_MIN_BATCHES * BATCH_BYTES {
                read_pos += self.push_batches_parallel(&bytes[read_pos..]);
                continue;
            }
            self.push_quad(&bytes[read_pos..read_pos + IN_BYTES_PER_QUAD]);
            read_pos += IN_BYTES_PER_QUAD;
        }

        // Buffer remaining bytes
        let remaining = len - read_pos;
        if remaining > 0 {
            self.buffer[..remaining].copy_from_slice(&bytes[read_pos..]);
            self.offset = remaining;
        }
        Ok(())
    }

    /// Build final tree and return (height, root)
    ///
    /// Works on copies, so it does not modify the hasher and can be called
    /// repeatedly and interleaved with `write()`.
    fn build(&self) -> (u8, [u8; NODE_SIZE]) {
        // Leaves of the partial batch, plus the buffered partial quad (or an
        // all-zero quad for empty input). The batch is never full at rest, so
        // everything fits in one batch.
        let mut nodes = [[0u8; NODE_SIZE]; BATCH_LEAVES];
        let mut len = self.batch.len() * 2;
        hash_many(as_messages(&self.batch), &mut nodes[..len]);
        if self.offset > 0 || self.bytes_written == 0 {
            let mut buffer = self.buffer;
            buffer[self.offset..].fill(0);
            let mut tail = [[0u8; OUT_BYTES_PER_QUAD]; 1];
            fr32_pad(&buffer, &mut tail[0]);
            hash_many(as_messages(&tail), &mut nodes[len..len + 2]);
            len += 2;
        }

        // Small input: the whole tree is this partial batch. Our leaves hash
        // 64-byte halves of a quad, so they are level 1 of the reference tree
        // (level 0 is the raw 32-byte FR32 chunks).
        if self.stack.count == 0 {
            let steps = len.next_power_of_two().trailing_zeros() as usize;
            reduce(&mut nodes, len, 1, steps);
            return ((steps + 1) as u8, nodes[0]);
        }

        // Pad the partial batch with zero leaves to a full batch. Since the
        // stack already holds at least one batch, this doesn't change the
        // padded tree size, so folding gives the same root and height.
        let mut stack = self.stack;
        if len > 0 {
            let mut concat = [0u8; 64];
            reduce(&mut nodes, len, 1, BATCH_LEVEL);
            stack.push_at(nodes[0], BATCH_LEVEL, &mut concat);
        }
        stack.fold()
    }

    /// Get the full multihash-encoded digest
    /// 
    /// Returns: [code (varint 0x1011), size (varint), padding (varint), height (u8), root (32 bytes)]
    /// 
    /// - `code`: 0x1011 = "fr32-sha256-trunc254-padded-binary-tree" multihash identifier
    /// - `size`: total digest size (padding_len + 1 + 32)
    /// - `padding`: bytes of zero-padding added to reach next power-of-two piece size  
    /// - `height`: tree height (log2 of piece size / 32)
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
        self.batch.clear();
        self.stack.count = 0;
    }
}

impl Default for CommPHasher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sha256::truncated_hash_64;
    use crate::tree::tests::naive_tree;

    #[test]
    fn test_hasher_basic() {
        let mut hasher = CommPHasher::new();
        hasher.write(&[0x42u8; 127]).unwrap();
        let root = hasher.root();
        assert_eq!(root.len(), 32);
    }

    #[test]
    fn test_height() {
        // One quad is 4 FR32 chunks: height 2 (#2)
        let mut hasher = CommPHasher::new();
        assert_eq!(hasher.height(), 2);
        hasher.write(&[0x42u8; 127]).unwrap();
        assert_eq!(hasher.height(), 2);
        hasher.write(&[0x42u8; 1]).unwrap();
        assert_eq!(hasher.height(), 3);
    }

    #[test]
    fn test_empty_digest() {
        // padding 127, height 2 (#4)
        let digest = CommPHasher::new().digest();
        assert_eq!(&digest[..5], &[0x91, 0x20, 0x22, 0x7f, 0x02]);
    }

    /// Naive CommP: FR32 pad every quad, hash each half, then naive tree
    fn naive_commp(data: &[u8]) -> (u8, [u8; NODE_SIZE]) {
        let mut padded_input = data.to_vec();
        let quads = data.len().div_ceil(IN_BYTES_PER_QUAD).max(1);
        padded_input.resize(quads * IN_BYTES_PER_QUAD, 0);
        let mut leaves = Vec::new();
        for quad in padded_input.chunks(IN_BYTES_PER_QUAD) {
            let mut out = [0u8; OUT_BYTES_PER_QUAD];
            fr32_pad(quad, &mut out);
            leaves.push(truncated_hash_64(out[..64].try_into().unwrap()));
            leaves.push(truncated_hash_64(out[64..].try_into().unwrap()));
        }
        naive_tree(&leaves)
    }

    #[test]
    fn test_batches_match_naive() {
        let batch_bytes = BATCH_QUADS * IN_BYTES_PER_QUAD;
        let data: Vec<u8> = (0..batch_bytes * 5 + 1000).map(|i| (i * 7 + i / 251) as u8).collect();
        let mut sizes = vec![0, 1, 127, 128, 254, 255];
        for k in 1..=5 {
            for delta in [-128isize, -127, -1, 0, 1, 127, 128] {
                sizes.push((batch_bytes * k).checked_add_signed(delta).unwrap());
            }
        }
        sizes.extend([batch_bytes * 2 + batch_bytes / 2, batch_bytes * 3 + 777]);

        for size in sizes {
            let mut hasher = CommPHasher::new();
            // Odd chunk size so quads straddle writes and batches
            for chunk in data[..size].chunks(1000) {
                hasher.write(chunk).unwrap();
            }
            assert_eq!(hasher.build(), naive_commp(&data[..size]), "{size} bytes");
        }
    }

    #[test]
    fn test_large_writes_match_naive() {
        // Large writes take the `parallel` path when it is enabled, starting
        // after any partial quad or batch left by the first write
        let batch_bytes = BATCH_QUADS * IN_BYTES_PER_QUAD;
        let data: Vec<u8> = (0..batch_bytes * 13 + 500).map(|i| (i * 13 + i / 509) as u8).collect();
        for size in [batch_bytes * 4, batch_bytes * 9 + 1, data.len()] {
            let expected = naive_commp(&data[..size]);
            for first in [0, 1, 127, 128, batch_bytes / 2 + 3, batch_bytes, batch_bytes + 127] {
                let mut hasher = CommPHasher::new();
                hasher.write(&data[..first]).unwrap();
                hasher.write(&data[first..size]).unwrap();
                assert_eq!(hasher.build(), expected, "{size} bytes, first write {first}");
            }
        }
    }

    #[test]
    fn test_write_spanning_parallel_groups() {
        // With `parallel`, one write of more than `PARALLEL_GROUP` batches is
        // hashed in several groups; compare with small writes, which never are
        let batch_bytes = BATCH_QUADS * IN_BYTES_PER_QUAD;
        let data: Vec<u8> = (0..batch_bytes * (2 * 256 + 37) + 99).map(|i| (i * 7 + i / 1021) as u8).collect();
        let mut expected = CommPHasher::new();
        for chunk in data.chunks(1000) {
            expected.write(chunk).unwrap();
        }
        for first in [0, 1, batch_bytes + 5] {
            let mut hasher = CommPHasher::new();
            hasher.write(&data[..first]).unwrap();
            hasher.write(&data[first..]).unwrap();
            assert_eq!(hasher.build(), expected.build(), "first write {first}");
        }
    }

    #[test]
    fn test_max_payload_size() {
        // Padding and piece size stay exact as JS numbers
        assert_eq!(MAX_PAYLOAD_SIZE, 17_873_661_021_126_656);
        assert_eq!(zero_padding(MAX_PAYLOAD_SIZE), 0);
        assert!(zero_padding(MAX_PAYLOAD_SIZE / 2 + 1) < 1 << 53);

        assert!(!exceeds_max_payload(0, 0));
        assert!(!exceeds_max_payload(MAX_PAYLOAD_SIZE - 10, 10));
        assert!(exceeds_max_payload(MAX_PAYLOAD_SIZE - 10, 11));
        assert!(exceeds_max_payload(MAX_PAYLOAD_SIZE, 1));
        assert!(!exceeds_max_payload(MAX_PAYLOAD_SIZE, 0));
        assert!(exceeds_max_payload(u64::MAX, usize::MAX));

        for len in [0, 1, 9, 10, 11, 12345, usize::MAX] {
            assert_eq!(
                max_payload_message(len),
                format!("Writing {len} bytes exceeds max payload size of {MAX_PAYLOAD_SIZE}")
            );
        }
    }

    #[test]
    fn test_build_is_repeatable() {
        let mut hasher = CommPHasher::new();
        hasher.write(&[0x42u8; 1000]).unwrap();
        let first = hasher.digest();
        assert_eq!(hasher.digest(), first);
        assert_eq!(hasher.root(), first[first.len() - 32..]);
        assert_eq!(hasher.height(), first[first.len() - 33]);

        // Writing after digest matches a single write
        hasher.write(&[0x43u8; 1000]).unwrap();
        let mut expected = CommPHasher::new();
        expected.write(&[0x42u8; 1000]).unwrap();
        expected.write(&[0x43u8; 1000]).unwrap();
        assert_eq!(hasher.digest(), expected.digest());
    }

    #[test]
    fn test_reset() {
        // Ported from go-fil-commp-hashhash's Reset tests
        let empty = CommPHasher::new().digest();

        // Before any write, and after an empty write
        let mut hasher = CommPHasher::new();
        hasher.reset();
        hasher.write(&[]).unwrap();
        hasher.reset();
        assert_eq!(hasher.digest(), empty);

        // After a write that only fills the quad buffer, repeatedly
        hasher.write(&[0x42]).unwrap();
        hasher.reset();
        hasher.reset();
        hasher.reset();
        assert_eq!(hasher.count(), 0);
        assert_eq!(hasher.digest(), empty);

        // After a full batch and a partial quad, then reused
        let data: Vec<u8> = (0..BATCH_QUADS * IN_BYTES_PER_QUAD * 2 + 64).map(|i| i as u8).collect();
        hasher.write(&data).unwrap();
        let _ = hasher.digest();
        hasher.reset();
        assert_eq!(hasher.digest(), empty);

        let data2: Vec<u8> = (0..127).map(|i| i as u8).collect();
        hasher.write(&data2).unwrap();
        let mut fresh = CommPHasher::new();
        fresh.write(&data2).unwrap();
        assert_eq!(hasher.digest(), fresh.digest());
        assert_eq!(32u64 << hasher.height(), 128);
    }
}
