//! NEON: 4 lanes, with bitwise select for `Ch` and `Maj`

use core::arch::aarch64::*;

#[derive(Clone, Copy)]
pub struct Neon(uint32x4_t);

impl super::Vector for Neon {
    const LANES: usize = 4;
    #[inline(always)]
    unsafe fn splat(x: u32) -> Self {
        Neon(vdupq_n_u32(x))
    }
    #[inline(always)]
    unsafe fn load(src: *const u32) -> Self {
        Neon(vld1q_u32(src))
    }
    #[inline(always)]
    unsafe fn store(self, dst: *mut u32) {
        vst1q_u32(dst, self.0)
    }
    #[inline(always)]
    unsafe fn add(self, b: Self) -> Self {
        Neon(vaddq_u32(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn xor(self, b: Self) -> Self {
        Neon(veorq_u32(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn and(self, b: Self) -> Self {
        Neon(vandq_u32(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn or(self, b: Self) -> Self {
        Neon(vorrq_u32(self.0, b.0))
    }
    #[inline(always)]
    unsafe fn shr<const N: i32>(self) -> Self {
        Neon(vshrq_n_u32::<N>(self.0))
    }
    /// Shift left, then shift-right-and-insert: 2 instructions
    #[inline(always)]
    unsafe fn rotr<const R: i32, const L: i32>(self) -> Self {
        Neon(vsriq_n_u32::<R>(vshlq_n_u32::<L>(self.0), self.0))
    }
    /// Bitwise select: 1 instruction
    #[inline(always)]
    unsafe fn ch(e: Self, f: Self, g: Self) -> Self {
        Neon(vbslq_u32(e.0, f.0, g.0))
    }
    /// Where `a` and `b` differ the majority is `c`, else `a`
    #[inline(always)]
    unsafe fn maj(a: Self, b: Self, c: Self) -> Self {
        Neon(vbslq_u32(veorq_u32(a.0, b.0), c.0, a.0))
    }
}
