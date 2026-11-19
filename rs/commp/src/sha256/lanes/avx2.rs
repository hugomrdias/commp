//! AVX2: 8 lanes, with 8x8 shuffle transposes in and out

use super::NODE_SIZE;
use core::arch::x86_64::*;

/// Reverses the bytes of each `u32` (SHA-256 words are big-endian)
#[inline(always)]
pub(super) unsafe fn bswap_mask() -> __m256i {
    _mm256_set_epi64x(0x1c1d1e1f_18191a1b, 0x14151617_10111213, 0x0c0d0e0f_08090a0b, 0x04050607_00010203)
}

/// Transpose an 8x8 matrix of `u32`: lane `l` of `out[j]` is lane `j`
/// of `rows[l]`
#[inline(always)]
pub(super) unsafe fn transpose8(r: [__m256i; 8]) -> [__m256i; 8] {
    // Pairs of rows interleaved: words (0, 1, 4, 5) and (2, 3, 6, 7)
    let t0 = _mm256_unpacklo_epi32(r[0], r[1]);
    let t1 = _mm256_unpackhi_epi32(r[0], r[1]);
    let t2 = _mm256_unpacklo_epi32(r[2], r[3]);
    let t3 = _mm256_unpackhi_epi32(r[2], r[3]);
    let t4 = _mm256_unpacklo_epi32(r[4], r[5]);
    let t5 = _mm256_unpackhi_epi32(r[4], r[5]);
    let t6 = _mm256_unpacklo_epi32(r[6], r[7]);
    let t7 = _mm256_unpackhi_epi32(r[6], r[7]);
    // Rows 0-3 and 4-7 of word j in the low half, word j + 4 in the high
    let u0 = _mm256_unpacklo_epi64(t0, t2);
    let u1 = _mm256_unpackhi_epi64(t0, t2);
    let u2 = _mm256_unpacklo_epi64(t1, t3);
    let u3 = _mm256_unpackhi_epi64(t1, t3);
    let u4 = _mm256_unpacklo_epi64(t4, t6);
    let u5 = _mm256_unpackhi_epi64(t4, t6);
    let u6 = _mm256_unpacklo_epi64(t5, t7);
    let u7 = _mm256_unpackhi_epi64(t5, t7);
    [
        _mm256_permute2x128_si256::<0x20>(u0, u4),
        _mm256_permute2x128_si256::<0x20>(u1, u5),
        _mm256_permute2x128_si256::<0x20>(u2, u6),
        _mm256_permute2x128_si256::<0x20>(u3, u7),
        _mm256_permute2x128_si256::<0x31>(u0, u4),
        _mm256_permute2x128_si256::<0x31>(u1, u5),
        _mm256_permute2x128_si256::<0x31>(u2, u6),
        _mm256_permute2x128_si256::<0x31>(u3, u7),
    ]
}

/// Words `8 * half..8 * half + 8` of 8 messages, message `l` in lane `l`
#[inline(always)]
pub(super) unsafe fn load_half(msgs: &[[u8; 64]], half: usize) -> [__m256i; 8] {
    let mask = bswap_mask();
    let mut rows = [_mm256_setzero_si256(); 8];
    for l in 0..8 {
        let row = _mm256_loadu_si256(msgs[l].as_ptr().add(32 * half) as *const __m256i);
        rows[l] = _mm256_shuffle_epi8(row, mask);
    }
    transpose8(rows)
}

/// Store 8 nodes from their state words, node `l` in lane `l`
#[inline(always)]
pub(super) unsafe fn store8(s: [__m256i; 8], out: &mut [[u8; NODE_SIZE]]) {
    let mask = bswap_mask();
    let nodes = transpose8(s);
    for l in 0..8 {
        _mm256_storeu_si256(out[l].as_mut_ptr() as *mut __m256i, _mm256_shuffle_epi8(nodes[l], mask));
    }
}

#[derive(Clone, Copy)]
pub struct Avx2(__m256i);

impl super::Vector for Avx2 {
    const LANES: usize = 8;
    #[inline(always)]
    unsafe fn splat(x: u32) -> Self {
        Avx2(_mm256_set1_epi32(x as i32))
    }
    #[inline(always)]
    unsafe fn load(src: *const u32) -> Self {
        Avx2(_mm256_loadu_si256(src as *const __m256i))
    }
    #[inline(always)]
    unsafe fn store(self, dst: *mut u32) {
        _mm256_storeu_si256(dst as *mut __m256i, self.0)
    }
    #[inline(always)]
    unsafe fn add(self, b: Self) -> Self {
        Avx2(_mm256_add_epi32(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn xor(self, b: Self) -> Self {
        Avx2(_mm256_xor_si256(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn and(self, b: Self) -> Self {
        Avx2(_mm256_and_si256(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn or(self, b: Self) -> Self {
        Avx2(_mm256_or_si256(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn shr<const N: i32>(self) -> Self {
        Avx2(_mm256_srli_epi32::<N>(self.0))
    }
    #[inline(always)]
    unsafe fn rotr<const R: i32, const L: i32>(self) -> Self {
        Avx2(_mm256_or_si256(_mm256_srli_epi32::<R>(self.0), _mm256_slli_epi32::<L>(self.0)))
    }
    #[inline(always)]
    unsafe fn load_messages(msgs: &[[u8; 64]]) -> [Self; 16] {
        let lo = load_half(msgs, 0);
        let hi = load_half(msgs, 1);
        let mut w = [Avx2(_mm256_setzero_si256()); 16];
        for j in 0..8 {
            w[j] = Avx2(lo[j]);
            w[j + 8] = Avx2(hi[j]);
        }
        w
    }
    #[inline(always)]
    unsafe fn store_nodes(s: [Self; 8], out: &mut [[u8; NODE_SIZE]]) {
        let mut v = [_mm256_setzero_si256(); 8];
        for k in 0..8 {
            v[k] = s[k].0;
        }
        store8(v, out);
    }
}
