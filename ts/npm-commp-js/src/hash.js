/**
 * Shared hashing utilities for CommP
 *
 * @module
 */

import { sha256Hash } from '@webbuf/sha256'
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
  // @ts-expect-error
  const hash = sha256Hash(data)
  const result = new Uint8Array(NODE_SIZE)
  result.set(hash._buf, 0)
  // Truncate: clear top 2 bits of last byte for field element representation
  result[NODE_SIZE - 1] &= 0b00111111
  return result
}
