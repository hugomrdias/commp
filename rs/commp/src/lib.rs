//! Fast CommP (Filecoin Piece Commitment) WASM implementation
//!
//! Optimized for maximum throughput with:
//! - 4-lane SIMD SHA-256 on wasm32 (4 independent 64-byte messages per `v128`)
//! - Leaves and subtrees hashed in fixed-size batches
//! - O(log n) streaming memory
//! - Integer-only size calculations

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use alloc::{string::String, vec::Vec};
use wasm_bindgen::prelude::*;

/// Trap without formatting a message, so no `core::fmt` code gets linked
#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// Smaller than std's dlmalloc
#[cfg(target_arch = "wasm32")]
#[global_allocator]
static TALC: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();

// `RUSTFLAGS` in the environment replaces `.cargo/config.toml` rustflags,
// which would silently drop SIMD and halve throughput
#[cfg(all(target_arch = "wasm32", not(target_feature = "simd128")))]
compile_error!("build with -C target-feature=+simd128 (see .cargo/config.toml)");

/// Size of a merkle tree node (32 bytes)
const NODE_SIZE: usize = 32;

/// Input bytes per quad (127 bytes = 4 * 254 bits / 8)
const IN_BYTES_PER_QUAD: usize = 127;

/// Output bytes per quad after FR32 padding (128 bytes)
const OUT_BYTES_PER_QUAD: usize = 128;

/// Maximum tree levels
const MAX_LEVEL: usize = 64;

/// Largest payload accepted, in bytes: 127 * 2^47 (~15.9 PiB)
///
/// data-segment allows up to tree height 255, far beyond `u64`. This is the
/// largest payload for which every derived size (padding, piece size) stays
/// below 2^53, so the digest fields are exact as JS numbers.
pub const MAX_PAYLOAD_SIZE: u64 = (IN_BYTES_PER_QUAD as u64) << 47;

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

/// Quads FR32-padded and hashed together before reducing to one subtree
const BATCH_QUADS: usize = 128;

/// Leaves per batch (2 per quad); must be a power of two
const BATCH_LEAVES: usize = BATCH_QUADS * 2;

/// Stack slot of a full batch's subtree root (`BATCH_LEAVES = 2^BATCH_LEVEL`)
const BATCH_LEVEL: usize = BATCH_LEAVES.trailing_zeros() as usize;

/// Pre-computed zero commitment nodes for each level (lazily initialized)
fn get_zero_comm(level: usize) -> [u8; NODE_SIZE] {
    #[cfg(not(target_arch = "wasm32"))]
    static ZERO_COMMS: std::sync::OnceLock<[[u8; NODE_SIZE]; MAX_LEVEL]> = std::sync::OnceLock::new();
    #[cfg(target_arch = "wasm32")]
    static ZERO_COMMS: SingleThreaded<core::cell::OnceCell<[[u8; NODE_SIZE]; MAX_LEVEL]>> =
        SingleThreaded(core::cell::OnceCell::new());

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

/// Lets a `static` hold a non-`Sync` value on wasm32
#[cfg(target_arch = "wasm32")]
struct SingleThreaded<T>(T);

// SAFETY: without the `atomics` target feature wasm32 has no threads
#[cfg(all(target_arch = "wasm32", not(target_feature = "atomics")))]
unsafe impl<T> Sync for SingleThreaded<T> {}

#[cfg(target_arch = "wasm32")]
impl<T> core::ops::Deref for SingleThreaded<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.0
    }
}

/// SHA-256 initial state
const IV: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

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
fn truncated_hash_64(data: &[u8; 64]) -> [u8; NODE_SIZE] {
    let mut state = IV;
    sha2::block_api::compress256(&mut state, &[*data, PAD_BLOCK]);
    let mut result = [0u8; NODE_SIZE];
    for (bytes, word) in result.chunks_exact_mut(4).zip(state) {
        bytes.copy_from_slice(&word.to_be_bytes());
    }
    result[NODE_SIZE - 1] &= 0b00111111;
    result
}

/// Hash many 64-byte messages into truncated nodes (portable fallback)
#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
fn hash_many(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    for (msg, node) in msgs.iter().zip(out.iter_mut()) {
        *node = truncated_hash_64(msg);
    }
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
use simd::hash_many;

/// 4-lane SHA-256 for wasm32 SIMD
///
/// sha2's `wasm32_simd128` backend only vectorizes the message schedule; the
/// rounds of each compression stay scalar. Every leaf and every node on a tree
/// level is independent, so here 4 messages are hashed at once, one per `u32`
/// lane of a `v128`.
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
mod simd {
    use super::{truncated_hash_64, IV, NODE_SIZE};
    use core::arch::wasm32::*;

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

    /// wasm SIMD has no rotate instruction
    #[inline(always)]
    fn rotr(x: v128, n: u32) -> v128 {
        v128_or(u32x4_shr(x, n), u32x4_shl(x, 32 - n))
    }

    /// Swap the bytes of each `u32` lane (SHA-256 words are big-endian)
    #[inline(always)]
    fn bswap(x: v128) -> v128 {
        i8x16_shuffle::<3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12>(x, x)
    }

    /// Transpose a 4x4 matrix of `u32`s held in 4 rows
    #[inline(always)]
    fn transpose(r0: v128, r1: v128, r2: v128, r3: v128) -> [v128; 4] {
        let t0 = u32x4_shuffle::<0, 4, 1, 5>(r0, r1);
        let t1 = u32x4_shuffle::<2, 6, 3, 7>(r0, r1);
        let t2 = u32x4_shuffle::<0, 4, 1, 5>(r2, r3);
        let t3 = u32x4_shuffle::<2, 6, 3, 7>(r2, r3);
        [
            u32x4_shuffle::<0, 1, 4, 5>(t0, t2),
            u32x4_shuffle::<2, 3, 6, 7>(t0, t2),
            u32x4_shuffle::<0, 1, 4, 5>(t1, t3),
            u32x4_shuffle::<2, 3, 6, 7>(t1, t3),
        ]
    }

    /// One SHA-256 round; callers rotate the variable names instead of
    /// moving the state
    macro_rules! round {
        ($a:ident, $b:ident, $c:ident, $d:ident, $e:ident, $f:ident, $g:ident, $h:ident, $kw:expr) => {
            let s1 = v128_xor(v128_xor(rotr($e, 6), rotr($e, 11)), rotr($e, 25));
            let ch = v128_xor($g, v128_and($e, v128_xor($f, $g)));
            let t1 = u32x4_add(u32x4_add($h, s1), u32x4_add(ch, $kw));
            let s0 = v128_xor(v128_xor(rotr($a, 2), rotr($a, 13)), rotr($a, 22));
            let maj = v128_or(v128_and($a, $b), v128_and($c, v128_or($a, $b)));
            $d = u32x4_add($d, t1);
            $h = u32x4_add(t1, u32x4_add(s0, maj));
        };
    }

    /// Eight rounds starting at `i`, rotating the names back to the start
    macro_rules! rounds8 {
        ($s:ident, $i:expr, |$j:ident| $kw:expr) => {{
            let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = $s;
            let kw = |$j: usize| $kw;
            round!(a, b, c, d, e, f, g, h, kw($i));
            round!(h, a, b, c, d, e, f, g, kw($i + 1));
            round!(g, h, a, b, c, d, e, f, kw($i + 2));
            round!(f, g, h, a, b, c, d, e, kw($i + 3));
            round!(e, f, g, h, a, b, c, d, kw($i + 4));
            round!(d, e, f, g, h, a, b, c, kw($i + 5));
            round!(c, d, e, f, g, h, a, b, kw($i + 6));
            round!(b, c, d, e, f, g, h, a, kw($i + 7));
            $s = [a, b, c, d, e, f, g, h];
        }};
    }

    /// Add the input state back after 64 rounds
    #[inline(always)]
    fn finish(input: [v128; 8], s: [v128; 8]) -> [v128; 8] {
        core::array::from_fn(|k| u32x4_add(input[k], s[k]))
    }

    /// Compress the message block; `w` holds its 16 words and is used as the
    /// ring buffer for the message schedule
    #[inline(always)]
    fn compress_message(state: [v128; 8], w: &mut [v128; 16]) -> [v128; 8] {
        let mut s = state;
        for i in (0..64).step_by(8) {
            if i >= 16 {
                for j in i..i + 8 {
                    let w15 = w[(j - 15) & 15];
                    let w2 = w[(j - 2) & 15];
                    let s0 = v128_xor(v128_xor(rotr(w15, 7), rotr(w15, 18)), u32x4_shr(w15, 3));
                    let s1 = v128_xor(v128_xor(rotr(w2, 17), rotr(w2, 19)), u32x4_shr(w2, 10));
                    w[j & 15] = u32x4_add(u32x4_add(w[j & 15], s0), u32x4_add(w[(j - 7) & 15], s1));
                }
            }
            rounds8!(s, i, |j| u32x4_add(w[j & 15], u32x4_splat(K[j])));
        }
        finish(state, s)
    }

    /// Compress the constant padding block, whose schedule is precomputed
    #[inline(always)]
    fn compress_padding(state: [v128; 8]) -> [v128; 8] {
        let mut s = state;
        for i in (0..64).step_by(8) {
            rounds8!(s, i, |j| u32x4_splat(PAD_KW[j]));
        }
        finish(state, s)
    }

    /// Hash 4 independent 64-byte messages into truncated nodes
    #[inline(always)]
    fn hash4(msgs: &[[u8; 64]; 4], out: &mut [[u8; NODE_SIZE]; 4]) {
        // w[i % 16] holds schedule word i of all 4 messages
        let mut w = [u32x4_splat(0); 16];
        for g in 0..4 {
            // SAFETY: each message is 64 bytes, so offset 16 * g + 16 is in bounds;
            // wasm loads have no alignment requirement
            let [r0, r1, r2, r3] = core::array::from_fn(|m| unsafe {
                bswap(v128_load(msgs[m].as_ptr().add(16 * g) as *const v128))
            });
            w[4 * g..4 * g + 4].copy_from_slice(&transpose(r0, r1, r2, r3));
        }

        let mid = compress_message(IV.map(|x| u32x4_splat(x)), &mut w);
        let s = compress_padding(mid);

        let lo = transpose(s[0], s[1], s[2], s[3]);
        let hi = transpose(s[4], s[5], s[6], s[7]);
        for m in 0..4 {
            let node = &mut out[m];
            // SAFETY: each node is 32 bytes; wasm stores have no alignment requirement
            unsafe {
                v128_store(node.as_mut_ptr() as *mut v128, bswap(lo[m]));
                v128_store(node.as_mut_ptr().add(16) as *mut v128, bswap(hi[m]));
            }
            node[NODE_SIZE - 1] &= 0b0011_1111;
        }
    }

    /// Hash many 64-byte messages into truncated nodes, 4 at a time
    pub fn hash_many(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
        let mut msg_groups = msgs.chunks_exact(4);
        let mut out_groups = out[..msgs.len()].chunks_exact_mut(4);
        for (m, o) in (&mut msg_groups).zip(&mut out_groups) {
            hash4(m.try_into().unwrap(), o.try_into().unwrap());
        }
        // A lone message is cheaper scalar; 2 or 3 share one padded group,
        // hashed by recursing so `hash4` is only inlined into the loop above
        match (msg_groups.remainder(), out_groups.into_remainder()) {
            ([], _) => {}
            ([msg], [node]) => *node = truncated_hash_64(msg),
            (rest, nodes) => {
                let mut group = [[0u8; 64]; 4];
                let mut out = [[0u8; NODE_SIZE]; 4];
                group[..rest.len()].copy_from_slice(rest);
                hash_many(&group, &mut out);
                nodes.copy_from_slice(&out[..nodes.len()]);
            }
        }
    }
}

/// View a level of nodes as the 64-byte messages formed by adjacent pairs
#[inline(always)]
fn as_pairs(nodes: &[[u8; NODE_SIZE]]) -> &[[u8; 64]] {
    debug_assert!(nodes.len() % 2 == 0);
    // SAFETY: [[u8; 32]; 2] and [u8; 64] have the same size and alignment (1)
    unsafe { core::slice::from_raw_parts(nodes.as_ptr() as *const [u8; 64], nodes.len() / 2) }
}

/// Reduce `len` nodes at tree `height` by `steps` levels, pairing an odd
/// trailing node with a zero commitment. The result is left at the start of
/// `nodes`; returns the remaining count.
#[inline(never)]
fn reduce(nodes: &mut [[u8; NODE_SIZE]], mut len: usize, mut height: usize, steps: usize) -> usize {
    let mut next = [[0u8; NODE_SIZE]; BATCH_LEAVES / 2];
    for _ in 0..steps {
        if len % 2 == 1 {
            nodes[len] = get_zero_comm(height);
            len += 1;
        }
        len /= 2;
        hash_many(as_pairs(&nodes[..len * 2]), &mut next[..len]);
        nodes[..len].copy_from_slice(&next[..len]);
        height += 1;
    }
    len
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

/// Pending subtree roots, one per tree level, updated like a binary counter
///
/// Bit `k` of `count` is set when `nodes[k]` holds the root of a complete
/// subtree of `2^k` leaves that is still waiting for its right sibling. Memory
/// is O(log n) regardless of input size.
#[derive(Clone, Copy)]
struct Stack {
    /// `nodes[k]` is a pending node at tree level `k + 1`
    nodes: [[u8; NODE_SIZE]; MAX_LEVEL],
    /// Number of leaves pushed so far
    count: u64,
}

impl Stack {
    fn new() -> Self {
        Stack {
            // A memset: the `[[0; 32]; 64]` literal is unrolled into 128 SIMD
            // stores at every call site, ~3KB each
            // SAFETY: all-zero bytes are a valid [[u8; 32]; 64]
            nodes: unsafe { core::mem::zeroed() },
            count: 0,
        }
    }

    /// Push the root of a complete subtree of `2^level` leaves, merging
    /// completed subtrees upward. `count` must be a multiple of `2^level`.
    #[inline]
    fn push_at(&mut self, root: [u8; NODE_SIZE], mut level: usize, concat: &mut [u8; 64]) {
        debug_assert!(self.count % (1 << level) == 0);
        self.count += 1 << level;
        let mut node = root;
        while self.count >> level & 1 == 0 {
            node = compute_node_into(&self.nodes[level], &node, concat);
            level += 1;
        }
        self.nodes[level] = node;
    }

    /// Fold pending nodes into the root, padding with zero commitments
    ///
    /// Our leaves hash 64-byte halves of a quad, so they are level 1 of the
    /// reference tree (level 0 is the raw 32-byte FR32 chunks). Requires at
    /// least two leaves. Returns (height, root).
    fn fold(&self) -> (u8, [u8; NODE_SIZE]) {
        let n = self.count;
        let top = (u64::BITS - 1 - n.leading_zeros()) as usize;
        if n.is_power_of_two() {
            return ((top + 1) as u8, self.nodes[top]);
        }

        // Carry the right-most partial subtree up to the level of `top`,
        // pairing it with a pending left sibling or a zero commitment
        let mut concat = [0u8; 64];
        let lowest = n.trailing_zeros() as usize;
        let mut acc = compute_node_into(&self.nodes[lowest], &get_zero_comm(lowest + 1), &mut concat);
        for level in lowest + 1..top {
            acc = if n >> level & 1 == 1 {
                compute_node_into(&self.nodes[level], &acc, &mut concat)
            } else {
                compute_node_into(&acc, &get_zero_comm(level + 1), &mut concat)
            };
        }

        ((top + 2) as u8, compute_node_into(&self.nodes[top], &acc, &mut concat))
    }
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
        let mut nodes = [[0u8; NODE_SIZE]; BATCH_LEAVES];
        hash_many(as_messages(&self.batch), &mut nodes);
        reduce(&mut nodes, BATCH_LEAVES, 1, BATCH_LEVEL);
        self.stack.push_at(nodes[0], BATCH_LEVEL, &mut self.concat_buffer);
        self.batch.clear();
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
pub fn digest(data: &[u8]) -> Result<Vec<u8>, JsValue> {
    let mut hasher = CommPHasher::new();
    hasher.write(data)?;
    Ok(hasher.digest())
}

/// One-shot root: returns just the 32-byte CommP root hash
/// 
/// Use this when you only need the raw hash without multihash encoding.
/// This is the Merkle root of the FR32-padded, SHA256-hashed binary tree.
#[wasm_bindgen]
pub fn root(data: &[u8]) -> Result<Vec<u8>, JsValue> {
    let mut hasher = CommPHasher::new();
    hasher.write(data)?;
    Ok(hasher.root())
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
        hasher.write(&[0x42u8; 127]).unwrap();
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

    /// Naive level-by-level tree over level-1 leaves, padding odd levels
    fn naive_tree(leaves: &[[u8; NODE_SIZE]]) -> (u8, [u8; NODE_SIZE]) {
        let mut concat = [0u8; 64];
        let mut current = leaves.to_vec();
        let mut height = 1u8;
        while current.len() > 1 {
            if current.len() % 2 == 1 {
                current.push(get_zero_comm(height as usize));
            }
            current = current
                .chunks(2)
                .map(|pair| compute_node_into(&pair[0], &pair[1], &mut concat))
                .collect();
            height += 1;
        }
        (height, current[0])
    }

    #[test]
    fn test_stack_matches_naive_tree() {
        let mut concat = [0u8; 64];
        let leaves: Vec<[u8; NODE_SIZE]> = (0..600u32)
            .map(|i| {
                let mut block = [0u8; 64];
                block[..4].copy_from_slice(&i.to_le_bytes());
                truncated_hash_64(&block)
            })
            .collect();

        let mut stack = Stack::new();
        for n in 1..=leaves.len() {
            stack.push_at(leaves[n - 1], 0, &mut concat);
            let (height, root) = stack.fold();
            if n == 1 {
                // A single leaf is its own root; never happens in practice
                assert_eq!((height, root), (1, leaves[0]));
                continue;
            }
            assert_eq!((height, root), naive_tree(&leaves[..n]), "{n} leaves");
        }
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
}
