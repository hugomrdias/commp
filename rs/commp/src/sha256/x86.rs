//! Multi-message SHA-256 with the x86 SHA extensions (SHA-NI)
//!
//! Same approach as `arm`: `sha256rnds2` has several cycles of latency, so
//! `LANES` independent messages are hashed in step, and the constant padding
//! block skips its message schedule. The state is kept in SHA-NI's `ABEF`,
//! `CDGH` word order until the end.

use super::{IV, K, NODE_SIZE, PAD_KW};
use core::arch::x86_64::*;

/// Messages hashed in step; more would spill the 16 XMM registers
const LANES: usize = 2;

/// Reverses the bytes of each `u32` (SHA-256 words are big-endian)
#[inline(always)]
unsafe fn bswap_mask() -> __m128i {
    _mm_set_epi64x(0x0c0d0e0f_08090a0b, 0x04050607_00010203)
}

/// 64 rounds on each lane's `(abef, cdgh)` state, taking `K[i] + W[i]`
/// four at a time from `kw(group, lane)`, after which `update(group,
/// lane)` may extend that lane's message schedule
macro_rules! rounds {
    ($abef:ident, $cdgh:ident, $n:expr, |$g:ident, $l:ident| $kw:expr, $update:expr) => {
        for $g in 0..16 {
            for $l in 0..$n {
                let kw = $kw;
                $cdgh[$l] = _mm_sha256rnds2_epu32($cdgh[$l], $abef[$l], kw);
                $abef[$l] = _mm_sha256rnds2_epu32($abef[$l], $cdgh[$l], _mm_shuffle_epi32(kw, 0x0e));
                $update;
            }
        }
    };
}

/// Hash `N` independent 64-byte messages into truncated nodes
#[inline(always)]
unsafe fn hash_lanes<const N: usize>(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    let mask = bswap_mask();
    // IV as ABEF, CDGH
    let dcba = _mm_loadu_si128(IV.as_ptr() as *const __m128i);
    let hgfe = _mm_loadu_si128(IV.as_ptr().add(4) as *const __m128i);
    let cdab = _mm_shuffle_epi32(dcba, 0xb1);
    let efgh = _mm_shuffle_epi32(hgfe, 0x1b);
    let iv = [_mm_alignr_epi8(cdab, efgh, 8), _mm_blend_epi16(efgh, cdab, 0xf0)];

    // w[lane][j] holds schedule words 4j..4j+4, overwritten in place by
    // the words 16 later
    let mut w: [[__m128i; 4]; N] = core::array::from_fn(|l| {
        core::array::from_fn(|j| {
            _mm_shuffle_epi8(_mm_loadu_si128(msgs[l].as_ptr().add(16 * j) as *const __m128i), mask)
        })
    });
    let mut abef = [iv[0]; N];
    let mut cdgh = [iv[1]; N];
    rounds!(abef, cdgh, N, |g, l| _mm_add_epi32(w[l][g % 4], _mm_loadu_si128(K.as_ptr().add(4 * g) as *const __m128i)), {
        if g < 12 {
            let next = _mm_sha256msg1_epu32(w[l][g % 4], w[l][(g + 1) % 4]);
            let next = _mm_add_epi32(next, _mm_alignr_epi8(w[l][(g + 3) % 4], w[l][(g + 2) % 4], 4));
            w[l][g % 4] = _mm_sha256msg2_epu32(next, w[l][(g + 3) % 4]);
        }
    });

    // Second block: the padding, whose K + W is precomputed
    let mid: [[__m128i; 2]; N] =
        core::array::from_fn(|l| [_mm_add_epi32(abef[l], iv[0]), _mm_add_epi32(cdgh[l], iv[1])]);
    let mut abef: [__m128i; N] = core::array::from_fn(|l| mid[l][0]);
    let mut cdgh: [__m128i; N] = core::array::from_fn(|l| mid[l][1]);
    rounds!(abef, cdgh, N, |g, l| _mm_loadu_si128(PAD_KW.as_ptr().add(4 * g) as *const __m128i), {});

    for l in 0..N {
        let abef = _mm_add_epi32(abef[l], mid[l][0]);
        let cdgh = _mm_add_epi32(cdgh[l], mid[l][1]);
        // Back to DCBA, HGFE, then big-endian bytes
        let feba = _mm_shuffle_epi32(abef, 0x1b);
        let dchg = _mm_shuffle_epi32(cdgh, 0xb1);
        let dcba = _mm_blend_epi16(feba, dchg, 0xf0);
        let hgfe = _mm_alignr_epi8(dchg, feba, 8);
        let node = out[l].as_mut_ptr() as *mut __m128i;
        _mm_storeu_si128(node, _mm_shuffle_epi8(dcba, mask));
        _mm_storeu_si128(node.add(1), _mm_shuffle_epi8(hgfe, mask));
        out[l][NODE_SIZE - 1] &= 0b0011_1111;
    }
}

/// Hash many 64-byte messages into truncated nodes, `LANES` at a time
#[target_feature(enable = "sha,ssse3,sse4.1")]
pub unsafe fn hash_many(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    let out = &mut out[..msgs.len()];
    let mut msg_groups = msgs.chunks_exact(LANES);
    let mut out_groups = out.chunks_exact_mut(LANES);
    for (m, o) in (&mut msg_groups).zip(&mut out_groups) {
        hash_lanes::<LANES>(m, o);
    }
    for (m, o) in msg_groups.remainder().iter().zip(out_groups.into_remainder()) {
        hash_lanes::<1>(core::slice::from_ref(m), core::slice::from_mut(o));
    }
}
