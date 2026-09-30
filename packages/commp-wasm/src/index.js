/**
 * Fast CommP (Filecoin Piece Commitment) WASM implementation
 *
 * This module provides a high-performance CommP calculation using
 * Rust/WASM with inline base64 encoding - no async init required.
 *
 * @module @hugomrdias/commp-wasm
 */

import { CommPHasher as WasmHasher, root as wasmRoot } from './inline/commp.js'
import { decode as varintDecode } from './varint.js'

/** @import { PieceDigest, StreamingHasher } from './types.js' */

/**
 * Largest slice passed to WASM per call. wasm-bindgen copies each input into
 * WASM memory, which never shrinks, so large inputs are fed in chunks.
 */
const CHUNK_SIZE = 1 << 20

/** Multihash code for fr32-sha2-256-trunc254-padded-binary-tree */
export const code = 0x1011

/** Multihash name */
export const name = /** @type {const} */ (
  'fr32-sha2-256-trunc254-padded-binary-tree'
)

/**
 * Streaming CommP hasher
 *
 * @example
 * ```ts twoslash
 * import { create } from '@hugomrdias/commp-wasm'
 *
 * const hasher = create()
 * hasher.write(new Uint8Array(1024).fill(0x42))
 * hasher.write(new Uint8Array(1024).fill(0x43))
 * const digest = hasher.digest()
 * console.log(digest.root) // 32-byte root hash
 * ```
 *
 * @implements {StreamingHasher}
 */
class Hasher {
  constructor() {
    /**
     * @private
     * @type {WasmHasher}
     */
    this.inner = new WasmHasher()
  }

  /**
   * Get the total number of bytes written
   *
   * @returns {bigint}
   */
  count() {
    return BigInt(this.inner.count())
  }

  /**
   * Write bytes into the hasher
   *
   * @param {Uint8Array} bytes - Bytes to write
   * @returns {this}
   * @throws {RangeError} If the total would exceed `MAX_PAYLOAD_SIZE`; the
   * hasher is left unchanged
   */
  write(bytes) {
    // Rust checks each chunk; check the whole write first so a rejected write
    // never leaves earlier chunks applied
    if (
      bytes.length > CHUNK_SIZE &&
      this.count() + BigInt(bytes.length) > MAX_PAYLOAD_SIZE
    ) {
      throw new RangeError(
        `Writing ${bytes.length} bytes exceeds max payload size of ${MAX_PAYLOAD_SIZE}`
      )
    }
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      this.inner.write(bytes.subarray(offset, offset + CHUNK_SIZE))
    }
    return this
  }

  /**
   * Compute the digest
   *
   * @returns {PieceDigest}
   */
  digest() {
    // Format: code (varint) | size (varint) | padding (varint) | height | root
    const bytes = this.inner.digest()
    const [, codeLength] = varintDecode(bytes, 0)
    const [, sizeLength] = varintDecode(bytes, codeLength)
    const digestStart = codeLength + sizeLength
    const [padding] = varintDecode(bytes, digestStart)

    return {
      code,
      name,
      digest: bytes.subarray(digestStart),
      bytes,
      height: bytes[bytes.length - ROOT_SIZE - HEIGHT_SIZE],
      root: bytes.slice(-ROOT_SIZE),
      padding,
    }
  }

  /**
   * Reset the hasher to initial state
   *
   * @returns {this}
   */
  reset() {
    this.inner.reset()
    return this
  }

  /**
   * Dispose of resources
   */
  dispose() {
    this.inner.free()
  }

  /**
   * Free WASM resources (alias for dispose)
   */
  free() {
    this.inner.free()
  }
}

/**
 * Creates a new streaming CommP hasher
 *
 * @example
 * ```ts twoslash
 * import { create, digest } from '@hugomrdias/commp-wasm'
 *
 * // Streaming API
 * const hasher = create()
 * hasher.write(chunk1)
 * hasher.write(chunk2)
 * const result = hasher.digest()
 *
 * // One-shot API
 * const result2 = digest(fullData)
 * ```
 *
 * @returns {Hasher}
 */
export function create() {
  return new Hasher()
}

/**
 * Computes CommP digest of a complete payload (one-shot)
 *
 * @example
 * ```ts twoslash
 * import { digest } from '@hugomrdias/commp-wasm'
 *
 * const data = new Uint8Array(1024 * 1024).fill(0x42)
 * const result = digest(data)
 * console.log(result.root) // 32-byte piece commitment
 * ```
 *
 * @param {Uint8Array} payload - Data to compute CommP for
 * @returns {PieceDigest}
 */
export function digest(payload) {
  const hasher = create()
  try {
    return hasher.write(payload).digest()
  } finally {
    hasher.free()
  }
}

/**
 * Computes just the 32-byte root hash (faster, less allocations)
 *
 * @example
 * ```ts twoslash
 * import { root } from '@hugomrdias/commp-wasm'
 *
 * const data = new Uint8Array(1024 * 1024).fill(0x42)
 * const rootHash = root(data)
 * console.log(rootHash) // 32-byte Uint8Array
 * ```
 *
 * @param {Uint8Array} payload - Data to compute CommP for
 * @returns {Uint8Array}
 */
export function root(payload) {
  if (payload.length <= CHUNK_SIZE) {
    return wasmRoot(payload)
  }
  const hasher = create()
  try {
    hasher.write(payload)
    return hasher.inner.root()
  } finally {
    hasher.free()
  }
}

// Re-export constants
export const NODE_SIZE = 32
export const IN_BYTES_PER_QUAD = 127
export const MIN_PAYLOAD_SIZE = 65

/**
 * Largest payload accepted, in bytes: 127 * 2^47 (~15.9 PiB)
 *
 * data-segment allows up to tree height 255, far beyond 64 bits. This is the
 * largest payload for which every derived size (padding, piece size) stays
 * below 2^53, so the digest fields are exact as JS numbers.
 */
export const MAX_PAYLOAD_SIZE = 127n << 47n
export const HEIGHT_SIZE = 1
export const ROOT_SIZE = 32
