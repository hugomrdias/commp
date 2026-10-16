/**
 * Fast CommP (Filecoin Piece Commitment) WASM implementation for workerd
 * (Cloudflare Workers)
 *
 * Imports the .wasm file so Wrangler compiles it ahead of time. workerd only
 * compiles WebAssembly from bytes during startup, so the inline base64 used by
 * index.js fails when the package is evaluated later (dynamic import, vitest).
 *
 * @module @hugomrdias/commp-wasm
 */

/**
 * Instantiates the precompiled WASM. Marked internal so the import stays out of
 * dist/index.workerd.d.ts, where the path doesn't exist.
 *
 * @internal
 */
import './inline/commp.workerd.js'

export * from './api.js'
