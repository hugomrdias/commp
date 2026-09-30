//! Picks the SHA-256 code for native targets from the build and the CPU

use super::hash_many_portable;
#[cfg(target_arch = "aarch64")]
use super::arm;
#[cfg(any(target_arch = "aarch64", target_arch = "x86_64"))]
use super::lanes;
#[cfg(target_arch = "x86_64")]
use super::x86;
use crate::NODE_SIZE;
use alloc::string::String;

/// SHA-256 code for leaves and nodes on native targets
#[derive(Clone, Copy, PartialEq)]
#[allow(dead_code)] // each target uses some of these
enum Backend {
    /// ARMv8 SHA2 instructions (`arm`)
    ArmSha2,
    /// x86 SHA extensions (`x86`)
    ShaNi,
    /// One message per `u32` lane of a SIMD register (`lanes`)
    Avx512,
    Avx2,
    Sse2,
    Neon,
    /// sha2, one message at a time (with its own SHA2 / SHA-NI if present)
    Portable,
}

impl Backend {
    /// Fastest first. SHA-NI stays ahead of AVX-512 until measured otherwise
    /// on a CPU that has both.
    const PREFERENCE: [Backend; 7] = [
        Backend::ArmSha2,
        Backend::ShaNi,
        Backend::Avx512,
        Backend::Avx2,
        Backend::Sse2,
        Backend::Neon,
        Backend::Portable,
    ];

    /// Set with `--cfg commp_backend="..."`, to benchmark one backend on a
    /// CPU that has faster ones
    const FORCED: Option<Backend> = if cfg!(commp_backend = "arm-sha2") {
        Some(Backend::ArmSha2)
    } else if cfg!(commp_backend = "sha-ni") {
        Some(Backend::ShaNi)
    } else if cfg!(commp_backend = "avx512") {
        Some(Backend::Avx512)
    } else if cfg!(commp_backend = "avx2") {
        Some(Backend::Avx2)
    } else if cfg!(commp_backend = "sse2") {
        Some(Backend::Sse2)
    } else if cfg!(commp_backend = "neon") {
        Some(Backend::Neon)
    } else if cfg!(commp_backend = "portable") {
        Some(Backend::Portable)
    } else {
        None
    };

    /// Whether this build and CPU can run the backend. `--cfg
    /// sha2_backend="soft"` (sha2's own switch) rules out the SHA-256
    /// instructions, to measure the rest.
    fn supported(self) -> bool {
        let sha = !cfg!(sha2_backend = "soft");
        match self {
            #[cfg(target_arch = "aarch64")]
            Backend::ArmSha2 => sha && std::arch::is_aarch64_feature_detected!("sha2"),
            // Part of every aarch64 target
            #[cfg(target_arch = "aarch64")]
            Backend::Neon => true,
            #[cfg(target_arch = "x86_64")]
            Backend::ShaNi => {
                sha && std::arch::is_x86_feature_detected!("sha")
                    && std::arch::is_x86_feature_detected!("ssse3")
                    && std::arch::is_x86_feature_detected!("sse4.1")
            }
            #[cfg(target_arch = "x86_64")]
            Backend::Avx512 => std::arch::is_x86_feature_detected!("avx512f"),
            #[cfg(target_arch = "x86_64")]
            Backend::Avx2 => std::arch::is_x86_feature_detected!("avx2"),
            // Part of every x86_64 target
            #[cfg(target_arch = "x86_64")]
            Backend::Sse2 => true,
            Backend::Portable => true,
            #[allow(unreachable_patterns)]
            _ => false,
        }
    }

    /// The forced backend if supported, else the fastest supported one
    #[inline]
    fn get() -> Backend {
        match Backend::FORCED {
            Some(forced) if forced.supported() => forced,
            _ => Backend::PREFERENCE.into_iter().find(|b| b.supported()).unwrap_or(Backend::Portable),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Backend::ArmSha2 => "ARMv8 SHA2, 4 messages interleaved",
            Backend::ShaNi => "SHA-NI, 2 messages interleaved",
            Backend::Avx512 => "AVX-512, 16 messages per SHA-256",
            Backend::Avx2 => "AVX2, 8 messages per SHA-256",
            Backend::Sse2 => "SSE2, 8 messages per SHA-256 (2 vectors)",
            Backend::Neon => "NEON, 8 messages per SHA-256 (2 vectors)",
            Backend::Portable => "sha2, one message at a time",
        }
    }
}

/// Hash many 64-byte messages into truncated nodes
pub fn hash_many(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    // SAFETY: `Backend::get()` only picks what the CPU supports
    unsafe {
        match Backend::get() {
            #[cfg(target_arch = "aarch64")]
            Backend::ArmSha2 => arm::hash_many(msgs, out),
            #[cfg(target_arch = "aarch64")]
            Backend::Neon => lanes::hash_many_neon(msgs, out),
            #[cfg(target_arch = "x86_64")]
            Backend::ShaNi => x86::hash_many(msgs, out),
            #[cfg(target_arch = "x86_64")]
            Backend::Avx512 => lanes::hash_many_avx512(msgs, out),
            #[cfg(target_arch = "x86_64")]
            Backend::Avx2 => lanes::hash_many_avx2(msgs, out),
            #[cfg(target_arch = "x86_64")]
            Backend::Sse2 => lanes::hash_many_sse2(msgs, out),
            _ => hash_many_portable(msgs, out),
        }
    }
}

/// Which SHA-256 code hashes leaves and nodes on this CPU, for benchmarks.
/// Says so when `commp_backend` forced it, or forced one the CPU lacks.
#[doc(hidden)]
pub fn sha256_backend() -> String {
    let backend = Backend::get();
    let mut name = String::from(backend.name());
    match Backend::FORCED {
        Some(forced) if forced == backend => name.push_str(", forced"),
        Some(forced) => {
            name.push_str(", forced ");
            name.push_str(forced.name().split(',').next().unwrap_or_default());
            name.push_str(" unavailable");
        }
        None => {}
    }
    name
}
