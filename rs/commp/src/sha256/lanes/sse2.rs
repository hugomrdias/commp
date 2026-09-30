//! SSE2: 4 lanes

use core::arch::x86_64::*;

#[derive(Clone, Copy)]
pub struct Sse2(__m128i);

impl super::Vector for Sse2 {
    const LANES: usize = 4;
    #[inline(always)]
    unsafe fn splat(x: u32) -> Self {
        Sse2(_mm_set1_epi32(x as i32))
    }
    #[inline(always)]
    unsafe fn load(src: *const u32) -> Self {
        Sse2(_mm_loadu_si128(src as *const __m128i))
    }
    #[inline(always)]
    unsafe fn store(self, dst: *mut u32) {
        _mm_storeu_si128(dst as *mut __m128i, self.0)
    }
    #[inline(always)]
    unsafe fn add(self, b: Self) -> Self {
        Sse2(_mm_add_epi32(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn xor(self, b: Self) -> Self {
        Sse2(_mm_xor_si128(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn and(self, b: Self) -> Self {
        Sse2(_mm_and_si128(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn or(self, b: Self) -> Self {
        Sse2(_mm_or_si128(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn shr<const N: i32>(self) -> Self {
        Sse2(_mm_srli_epi32::<N>(self.0))
    }
    #[inline(always)]
    unsafe fn rotr<const R: i32, const L: i32>(self) -> Self {
        Sse2(_mm_or_si128(_mm_srli_epi32::<R>(self.0), _mm_slli_epi32::<L>(self.0)))
    }
}
