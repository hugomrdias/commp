/**
 * Shared hashing utilities for CommP
 *
 * @module
 */

import { NODE_SIZE } from './constants.js'
import { sha256x64Into } from './sha256.js'

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
 * @param {Uint8Array} data - 64 bytes to hash
 * @returns {Uint8Array} - 32-byte truncated hash (new allocation)
 */
export function truncatedHash(data) {
  const result = new Uint8Array(NODE_SIZE)
  truncatedHashInto(data, 0, result, 0)
  return result
}

/**
 * Computes truncated SHA256 hash of the 64 bytes of `data` at `offset` into
 * `out` at `outOffset`
 *
 * @param {Uint8Array} data - Data to hash
 * @param {number} offset - Byte offset of the 64-byte input in `data`
 * @param {Uint8Array} out - Output buffer
 * @param {number} outOffset - Byte offset of the 32-byte result in `out`
 */
export function truncatedHashInto(data, offset, out, outOffset) {
  sha256x64Into(data, offset, out, outOffset)
  // Truncate: clear top 2 bits of last byte for field element representation
  out[outOffset + NODE_SIZE - 1] &= 0b00111111
}
