//! AVX-512: 16 lanes, with real rotates and `vpternlogd`; transposes in
//! and out reuse AVX2's on each half

use super::avx2::{load_half, store8};
use super::NODE_SIZE;
use core::arch::x86_64::*;

#[derive(Clone, Copy)]
pub struct Avx512(__m512i);

impl super::Vector for Avx512 {
    const LANES: usize = 16;
    #[inline(always)]
    unsafe fn splat(x: u32) -> Self {
        Avx512(_mm512_set1_epi32(x as i32))
    }
    #[inline(always)]
    unsafe fn load(src: *const u32) -> Self {
        Avx512(_mm512_loadu_si512(src as *const _))
    }
    #[inline(always)]
    unsafe fn store(self, dst: *mut u32) {
        _mm512_storeu_si512(dst as *mut _, self.0)
    }
    #[inline(always)]
    unsafe fn add(self, b: Self) -> Self {
        Avx512(_mm512_add_epi32(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn xor(self, b: Self) -> Self {
        Avx512(_mm512_xor_si512(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn and(self, b: Self) -> Self {
        Avx512(_mm512_and_si512(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn or(self, b: Self) -> Self {
        Avx512(_mm512_or_si512(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn shr<const N: i32>(self) -> Self {
        Avx512(_mm512_srl_epi32(self.0, _mm_cvtsi32_si128(N)))
    }
    /// A real rotate: 1 instruction
    #[inline(always)]
    unsafe fn rotr<const R: i32, const L: i32>(self) -> Self {
        Avx512(_mm512_ror_epi32::<R>(self.0))
    }
    // `vpternlogd` evaluates any 3-input bitwise function; the
    // immediate is its truth table over (a, b, c) = (0xf0, 0xcc, 0xaa)
    #[inline(always)]
    unsafe fn xor3(a: Self, b: Self, c: Self) -> Self {
        Avx512(_mm512_ternarylogic_epi32::<0x96>(a.0, b.0, c.0))
    }
    #[inline(always)]
    unsafe fn ch(e: Self, f: Self, g: Self) -> Self {
        Avx512(_mm512_ternarylogic_epi32::<0xca>(e.0, f.0, g.0))
    }
    #[inline(always)]
    unsafe fn maj(a: Self, b: Self, c: Self) -> Self {
        Avx512(_mm512_ternarylogic_epi32::<0xe8>(a.0, b.0, c.0))
    }
    /// Messages 0-7 and 8-15 transposed as two AVX2 halves, then joined
    #[inline(always)]
    unsafe fn load_messages(msgs: &[[u8; 64]]) -> [Self; 16] {
        let mut w = [Avx512(_mm512_setzero_si512()); 16];
        for half in 0..2 {
            let lo = load_half(&msgs[..8], half);
            let hi = load_half(&msgs[8..], half);
            for j in 0..8 {
                w[8 * half + j] = Avx512(_mm512_inserti64x4::<1>(
                    _mm512_castsi256_si512(lo[j]),
                    hi[j],
                ));
            }
        }
        w
    }
    #[inline(always)]
    unsafe fn store_nodes(s: [Self; 8], out: &mut [[u8; NODE_SIZE]]) {
        let mut lo = [_mm256_setzero_si256(); 8];
        let mut hi = [_mm256_setzero_si256(); 8];
        for k in 0..8 {
            lo[k] = _mm512_castsi512_si256(s[k].0);
            hi[k] = _mm512_extracti64x4_epi64::<1>(s[k].0);
        }
        store8(lo, &mut out[..8]);
        store8(hi, &mut out[8..]);
    }
}
