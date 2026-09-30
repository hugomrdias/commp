//! AVX-512: 16 lanes, with real rotates and `vpternlogd`

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
}
