//! Multi-message SHA-256 in software, for CPUs without SHA-256 instructions
//!
//! The `wasm` module's approach on native SIMD: one message per `u32`
//! lane, so each vector instruction advances `LANES` messages at once. The
//! rounds are generic over [`Vector`]; each backend is a few intrinsics.

use super::{truncated_hash_64, IV, K, NODE_SIZE, PAD_KW};

/// Most lanes of any [`Vector`], which sizes the transpose buffers
const MAX_LANES: usize = 16;

/// A SIMD register of `u32` lanes
///
/// Methods are `unsafe` because they need the backend's target feature;
/// they are only reached through the `hash_many_*` entry points below.
trait Vector: Copy {
    const LANES: usize;
    unsafe fn splat(x: u32) -> Self;
    /// Load `LANES` words
    unsafe fn load(src: *const u32) -> Self;
    /// Store `LANES` words
    unsafe fn store(self, dst: *mut u32);
    unsafe fn add(self, b: Self) -> Self;
    unsafe fn xor(self, b: Self) -> Self;
    unsafe fn and(self, b: Self) -> Self;
    unsafe fn or(self, b: Self) -> Self;
    unsafe fn shr<const N: i32>(self) -> Self;
    /// Rotate right by `R`; `L` must be `32 - R`
    unsafe fn rotr<const R: i32, const L: i32>(self) -> Self;

    /// The 16 big-endian words of `LANES` messages, message `l` in lane
    /// `l`. Backends with shuffles override this scalar transpose.
    #[inline(always)]
    unsafe fn load_messages(msgs: &[[u8; 64]]) -> [Self; 16] {
        let mut buf = [0u32; MAX_LANES];
        let mut w = [Self::splat(0); 16];
        for (j, word) in w.iter_mut().enumerate() {
            for (l, msg) in msgs.iter().enumerate() {
                buf[l] = u32::from_be_bytes(msg[4 * j..4 * j + 4].try_into().unwrap());
            }
            *word = Self::load(buf.as_ptr());
        }
        w
    }

    /// Store the state words of `LANES` hashes as big-endian nodes, the
    /// inverse of [`Vector::load_messages`]
    #[inline(always)]
    unsafe fn store_nodes(s: [Self; 8], out: &mut [[u8; NODE_SIZE]]) {
        let mut buf = [0u32; MAX_LANES];
        for (k, word) in s.iter().enumerate() {
            word.store(buf.as_mut_ptr());
            for (l, node) in out.iter_mut().enumerate() {
                node[4 * k..4 * k + 4].copy_from_slice(&buf[l].to_be_bytes());
            }
        }
    }

    /// `a ^ b ^ c`
    #[inline(always)]
    unsafe fn xor3(a: Self, b: Self, c: Self) -> Self {
        a.xor(b).xor(c)
    }

    /// SHA-256 `Ch(e, f, g)`
    #[inline(always)]
    unsafe fn ch(e: Self, f: Self, g: Self) -> Self {
        g.xor(e.and(f.xor(g)))
    }

    /// SHA-256 `Maj(a, b, c)`
    #[inline(always)]
    unsafe fn maj(a: Self, b: Self, c: Self) -> Self {
        a.and(b).or(c.and(a.or(b)))
    }
}

/// One SHA-256 round; callers rotate the variable names instead of
/// moving the state
macro_rules! round {
    ($a:ident, $b:ident, $c:ident, $d:ident, $e:ident, $f:ident, $g:ident, $h:ident, $kw:expr) => {
        let s1 = V::xor3($e.rotr::<6, 26>(), $e.rotr::<11, 21>(), $e.rotr::<25, 7>());
        let t1 = $h.add(s1).add(V::ch($e, $f, $g).add($kw));
        let s0 = V::xor3($a.rotr::<2, 30>(), $a.rotr::<13, 19>(), $a.rotr::<22, 10>());
        $d = $d.add(t1);
        $h = t1.add(s0.add(V::maj($a, $b, $c)));
    };
}

/// Eight rounds starting at `i`, rotating the names back to the start
macro_rules! rounds8 {
    ($s:ident, $i:expr, |$j:ident| $kw:expr) => {{
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = $s;
        round!(a, b, c, d, e, f, g, h, { let $j: usize = $i; $kw });
        round!(h, a, b, c, d, e, f, g, { let $j: usize = $i + 1; $kw });
        round!(g, h, a, b, c, d, e, f, { let $j: usize = $i + 2; $kw });
        round!(f, g, h, a, b, c, d, e, { let $j: usize = $i + 3; $kw });
        round!(e, f, g, h, a, b, c, d, { let $j: usize = $i + 4; $kw });
        round!(d, e, f, g, h, a, b, c, { let $j: usize = $i + 5; $kw });
        round!(c, d, e, f, g, h, a, b, { let $j: usize = $i + 6; $kw });
        round!(b, c, d, e, f, g, h, a, { let $j: usize = $i + 7; $kw });
        $s = [a, b, c, d, e, f, g, h];
    }};
}

/// Runs `$body` with `$i` bound to each round group start `0, 8, .., 56`,
/// written out so that every index into the message schedule is a
/// constant: LLVM does not unroll a loop this large, which leaves the
/// schedule on the stack
macro_rules! unroll8 {
    (|$i:ident| $body:block) => {
        unroll8!(@ $i, $body, 0 8 16 24 32 40 48 56)
    };
    (@ $i:ident, $body:block, $($n:literal)*) => {
        $( { let $i: usize = $n; $body } )*
    };
}

/// `state + s`, lane-wise. Plain loops here, not `array::from_fn` or
/// `map`: closures don't inherit the caller's target features, so their
/// intrinsics would not inline.
#[inline(always)]
unsafe fn add_state<V: Vector>(state: [V; 8], s: [V; 8]) -> [V; 8] {
    let mut out = state;
    for k in 0..8 {
        out[k] = out[k].add(s[k]);
    }
    out
}

/// Compress the message block; `w` holds its 16 words and is used as the
/// ring buffer for the message schedule
#[inline(always)]
unsafe fn compress_message<V: Vector>(state: [V; 8], w: &mut [V; 16]) -> [V; 8] {
    let mut s = state;
    unroll8!(|i| {
        if i >= 16 {
            for j in i..i + 8 {
                let w15 = w[(j - 15) & 15];
                let w2 = w[(j - 2) & 15];
                let s0 = V::xor3(w15.rotr::<7, 25>(), w15.rotr::<18, 14>(), w15.shr::<3>());
                let s1 = V::xor3(w2.rotr::<17, 15>(), w2.rotr::<19, 13>(), w2.shr::<10>());
                w[j & 15] = w[j & 15].add(s0).add(w[(j - 7) & 15].add(s1));
            }
        }
        rounds8!(s, i, |j| w[j & 15].add(V::splat(K[j])));
    });
    add_state(state, s)
}

/// Compress the constant padding block, whose schedule is precomputed
#[inline(always)]
unsafe fn compress_padding<V: Vector>(state: [V; 8]) -> [V; 8] {
    let mut s = state;
    unroll8!(|i| {
        rounds8!(s, i, |j| V::splat(PAD_KW[j]));
    });
    add_state(state, s)
}

/// Hash `V::LANES` independent 64-byte messages into truncated nodes
#[inline(always)]
unsafe fn hash_group<V: Vector>(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    let mut w = V::load_messages(msgs);
    let mut iv = [V::splat(0); 8];
    for k in 0..8 {
        iv[k] = V::splat(IV[k]);
    }
    let mid = compress_message(iv, &mut w);
    let mut s = compress_padding(mid);
    // Truncate to 254 bits: the top two bits of the node's last byte, the
    // low byte of the big-endian word 7
    s[7] = s[7].and(V::splat(0xffff_ff3f));
    V::store_nodes(s, out);
}

/// Hash many 64-byte messages into truncated nodes, `V::LANES` at a time
#[inline(always)]
unsafe fn hash_many<V: Vector>(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    const { assert!(V::LANES <= MAX_LANES) };
    let lanes = V::LANES;
    let out = &mut out[..msgs.len()];
    let groups = msgs.len() / lanes;
    let rest = msgs.len() % lanes;
    // A short last group of 2 or more is zero-padded and hashed in the
    // same loop, from these buffers: one call site, so the unrolled rounds
    // are inlined once. A lone message is cheaper scalar.
    let padded = rest > 1;
    let mut pad_msgs = [[0u8; 64]; MAX_LANES];
    let mut pad_out = [[0u8; NODE_SIZE]; MAX_LANES];
    if padded {
        pad_msgs[..rest].copy_from_slice(&msgs[groups * lanes..]);
    }
    for g in 0..groups + padded as usize {
        let (src, dst) = if g < groups {
            (&msgs[g * lanes..][..lanes], &mut out[g * lanes..][..lanes])
        } else {
            (&pad_msgs[..lanes], &mut pad_out[..lanes])
        };
        hash_group::<V>(src, dst);
    }
    if padded {
        out[groups * lanes..].copy_from_slice(&pad_out[..rest]);
    } else if rest == 1 {
        out[groups * lanes] = truncated_hash_64(&msgs[groups * lanes]);
    }
}

/// Two vectors used as one: independent instruction chains for CPUs
/// that can run several SIMD instructions per cycle
#[derive(Clone, Copy)]
struct Pair<V>(V, V);

impl<V: Vector> Vector for Pair<V> {
    const LANES: usize = 2 * V::LANES;
    #[inline(always)]
    unsafe fn splat(x: u32) -> Self {
        Pair(V::splat(x), V::splat(x))
    }
    #[inline(always)]
    unsafe fn load(src: *const u32) -> Self {
        Pair(V::load(src), V::load(src.add(V::LANES)))
    }
    #[inline(always)]
    unsafe fn store(self, dst: *mut u32) {
        self.0.store(dst);
        self.1.store(dst.add(V::LANES));
    }
    #[inline(always)]
    unsafe fn add(self, b: Self) -> Self {
        Pair(self.0.add(b.0), self.1.add(b.1))
    }
    #[inline(always)]
    unsafe fn xor(self, b: Self) -> Self {
        Pair(self.0.xor(b.0), self.1.xor(b.1))
    }
    #[inline(always)]
    unsafe fn and(self, b: Self) -> Self {
        Pair(self.0.and(b.0), self.1.and(b.1))
    }
    #[inline(always)]
    unsafe fn or(self, b: Self) -> Self {
        Pair(self.0.or(b.0), self.1.or(b.1))
    }
    #[inline(always)]
    unsafe fn shr<const N: i32>(self) -> Self {
        Pair(self.0.shr::<N>(), self.1.shr::<N>())
    }
    #[inline(always)]
    unsafe fn rotr<const R: i32, const L: i32>(self) -> Self {
        Pair(self.0.rotr::<R, L>(), self.1.rotr::<R, L>())
    }
    #[inline(always)]
    unsafe fn xor3(a: Self, b: Self, c: Self) -> Self {
        Pair(V::xor3(a.0, b.0, c.0), V::xor3(a.1, b.1, c.1))
    }
    #[inline(always)]
    unsafe fn ch(e: Self, f: Self, g: Self) -> Self {
        Pair(V::ch(e.0, f.0, g.0), V::ch(e.1, f.1, g.1))
    }
    #[inline(always)]
    unsafe fn maj(a: Self, b: Self, c: Self) -> Self {
        Pair(V::maj(a.0, b.0, c.0), V::maj(a.1, b.1, c.1))
    }
}

#[cfg(target_arch = "aarch64")]
mod neon;
#[cfg(target_arch = "x86_64")]
mod avx512;
#[cfg(target_arch = "x86_64")]
mod avx2;
#[cfg(target_arch = "x86_64")]
mod sse2;

/// NEON is part of every aarch64 target
#[cfg(target_arch = "aarch64")]
#[target_feature(enable = "neon")]
pub unsafe fn hash_many_neon(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    hash_many::<Pair<neon::Neon>>(msgs, out)
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512f,avx2")]
pub unsafe fn hash_many_avx512(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    hash_many::<avx512::Avx512>(msgs, out)
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
pub unsafe fn hash_many_avx2(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    hash_many::<avx2::Avx2>(msgs, out)
}

/// SSE2 is part of every x86_64 target
#[cfg(target_arch = "x86_64")]
pub unsafe fn hash_many_sse2(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    hash_many::<Pair<sse2::Sse2>>(msgs, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every backend this CPU supports matches sha2, for every group
    /// remainder
    #[test]
    fn test_lanes_match_sha2() {
        let msgs: Vec<[u8; 64]> = (0..37u32)
            .map(|i| core::array::from_fn(|b| (i as u8).wrapping_mul(31) ^ (b as u8).wrapping_mul(7)))
            .collect();
        let expected: Vec<[u8; NODE_SIZE]> = msgs.iter().map(truncated_hash_64).collect();

        #[allow(clippy::type_complexity)]
        let mut backends: Vec<(&str, unsafe fn(&[[u8; 64]], &mut [[u8; NODE_SIZE]]))> = Vec::new();
        #[cfg(target_arch = "aarch64")]
        backends.push(("neon", hash_many_neon));
        #[cfg(target_arch = "x86_64")]
        {
            backends.push(("sse2", hash_many_sse2));
            if std::arch::is_x86_feature_detected!("avx2") {
                backends.push(("avx2", hash_many_avx2));
            }
            if std::arch::is_x86_feature_detected!("avx512f") {
                backends.push(("avx512", hash_many_avx512));
            }
        }
        for (name, hash) in backends {
            for n in 0..msgs.len() {
                let mut out = vec![[0u8; NODE_SIZE]; n];
                unsafe { hash(&msgs[..n], &mut out) };
                assert_eq!(out, expected[..n], "{name}, {n} messages");
            }
        }
    }
}
