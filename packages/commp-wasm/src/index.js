/**
 * Fast CommP (Filecoin Piece Commitment) WASM implementation
 *
 * This module provides a high-performance CommP calculation using
 * Rust/WASM with inline base64 encoding - no async init required.
 *
 * @module @hugomrdias/commp-wasm
 */

/**
 * Compiles the inline base64 WASM; see index.workerd.js for Cloudflare Workers.
 * Marked internal so the import stays out of dist/index.d.ts, where the path
 * doesn't exist.
 *
 * @internal
 */
import './inline/commp.js'

export * from './api.js'
