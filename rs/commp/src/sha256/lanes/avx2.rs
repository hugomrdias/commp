//! AVX2: 8 lanes

use core::arch::x86_64::*;

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
}
