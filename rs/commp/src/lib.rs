//! Fast CommP (Filecoin Piece Commitment) WASM implementation
//!
//! Optimized for maximum throughput with:
//! - 4-lane SIMD SHA-256 on wasm32 (4 independent 64-byte messages per `v128`)
//! - Native: ARMv8 SHA2 / x86 SHA-NI instructions on several messages at once,
//!   else NEON / AVX-512 / AVX2 / SSE2 with one message per lane, and with the
//!   `parallel` feature, large writes hashed on all cores
//! - Leaves and subtrees hashed in fixed-size batches
//! - O(log n) streaming memory
//! - Integer-only size calculations

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use alloc::vec::Vec;
use wasm_bindgen::prelude::*;

mod fr32;
mod hasher;
mod multihash;
mod sha256;
mod tree;

pub use hasher::CommPHasher;
#[doc(hidden)]
#[cfg(not(target_arch = "wasm32"))]
pub use sha256::sha256_backend;

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

/// Quads FR32-padded and hashed together before reducing to one subtree
const BATCH_QUADS: usize = 128;

/// Leaves per batch (2 per quad); must be a power of two
const BATCH_LEAVES: usize = BATCH_QUADS * 2;

/// Stack slot of a full batch's subtree root (`BATCH_LEAVES = 2^BATCH_LEVEL`)
const BATCH_LEVEL: usize = BATCH_LEAVES.trailing_zeros() as usize;

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
