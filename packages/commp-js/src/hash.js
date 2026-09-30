/**
 * Shared hashing utilities for CommP
 *
 * @module
 */

// Raw wasm binding: takes/returns plain Uint8Array. The public `sha256Hash`
// wraps output in WebBuf/FixedBuf, which is ~10x slower for 64-byte inputs.
import { sha256_hash } from '@webbuf/sha256/dist/rs-webbuf_sha256-inline-base64/webbuf_sha256.js'
import { NODE_SIZE } from './constants.js'

/**
 * Reusable buffer for concatenating two nodes before hashing (64 bytes)
 * @type {Uint8Array}
 */
export const CONCAT_BUFFER = new Uint8Array(NODE_SIZE * 2)

/**
 * Computes truncated SHA256 hash, clearing top 2 bits of last byte
 *
 * This is used throughout CommP for merkle tree node computation.
 * The truncation ensures the result fits in a 254-bit field element.
 *
 * @param {Uint8Array} data - Data to hash
 * @returns {Uint8Array} - 32-byte truncated hash (new allocation)
 */
export function truncatedHash(data) {
  const result = new Uint8Array(NODE_SIZE)
  truncatedHashInto(data, result, 0)
  return result
}

/**
 * Computes truncated SHA256 hash into `out` at `outOffset`
 *
 * @param {Uint8Array} data - Data to hash
 * @param {Uint8Array} out - Output buffer
 * @param {number} outOffset - Byte offset of the 32-byte result in `out`
 */
export function truncatedHashInto(data, out, outOffset) {
  out.set(sha256_hash(data), outOffset)
  // Truncate: clear top 2 bits of last byte for field element representation
  out[outOffset + NODE_SIZE - 1] &= 0b00111111
}
