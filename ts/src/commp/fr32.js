/**
 * Optimized FR32 padding with fused SHA256 hashing
 *
 * FR32 padding adds 2 bits of padding per 254 bits of data, expanding
 * 127 bytes (quad) to 128 bytes. This module fuses the padding operation
 * with immediate SHA256 hashing to avoid intermediate allocations.
 *
 * @module
 */

import {
  FR_RATIO,
  MIN_PAYLOAD_SIZE,
  NODE_SIZE,
  OUT_BYTES_PER_QUAD,
} from './constants.js'
import { truncatedHash } from './hash.js'

/**
 * Reusable buffer for FR32 padded output (128 bytes)
 * @type {Uint8Array}
 */
const FR32_BUFFER = new Uint8Array(OUT_BYTES_PER_QUAD)

/**
 * FR32 pads a 127-byte quad into the provided 128-byte output buffer
 *
 * FR32 encoding inserts 2 zero bits every 254 bits (31.75 bytes).
 * Each 127-byte input becomes 128 bytes with 4 zero-bit insertions.
 *
 * @param {Uint8Array} source - Source data (at least 127 bytes from offset)
 * @param {number} offset - Offset into source to read from
 * @param {Uint8Array} output - 128-byte output buffer
 */
export function fr32PadInto(source, offset, output) {
  // First 31 bytes + 6 bits are taken as-is
  for (let i = 0; i < 32; i++) {
    output[i] = source[offset + i]
  }
  // First 2-bit shim: clear top 2 bits
  output[31] &= 0b00111111

  // Second Fr: shift by 2 bits, combine with previous byte's top 6 bits
  for (let i = 32; i < 64; i++) {
    output[i] = (source[offset + i] << 2) | (source[offset + i - 1] >> 6)
  }
  output[63] &= 0b00111111

  // Third Fr: shift by 4 bits
  for (let i = 64; i < 96; i++) {
    output[i] = (source[offset + i] << 4) | (source[offset + i - 1] >> 4)
  }
  output[95] &= 0b00111111

  // Fourth Fr: shift by 6 bits
  for (let i = 96; i < 127; i++) {
    output[i] = (source[offset + i] << 6) | (source[offset + i - 1] >> 2)
  }
  // Last byte: just the top 6 bits of byte 126
  output[127] = source[offset + 126] >> 2
}

/**
 * Reads a 127-byte quad, FR32 pads it, and immediately hashes to produce 2 leaf nodes.
 * This fused operation avoids intermediate allocations.
 *
 * @example
 * ```ts twoslash
 * import { readQuad } from './fr32.js'
 *
 * const data = new Uint8Array(127).fill(0x42)
 * const leaves = new Uint8Array(64) // 2 x 32-byte nodes
 * readQuad(data, 0, leaves, 0)
 * // leaves now contains 2 truncated SHA256 hashes
 * ```
 *
 * @param {Uint8Array} source - Source data containing the quad
 * @param {number} sourceOffset - Offset into source where quad starts
 * @param {Uint8Array} leaves - Output buffer for leaf nodes (flat array of 32-byte nodes)
 * @param {number} leafOffset - Byte offset into leaves buffer where to write
 */
export function readQuad(source, sourceOffset, leaves, leafOffset) {
  // FR32 pad into reusable buffer
  fr32PadInto(source, sourceOffset, FR32_BUFFER)

  // Hash first 64 bytes → leaf 1
  const leaf1 = truncatedHash(FR32_BUFFER.subarray(0, 64))
  leaves.set(leaf1, leafOffset)

  // Hash last 64 bytes → leaf 2
  const leaf2 = truncatedHash(FR32_BUFFER.subarray(64, 128))
  leaves.set(leaf2, leafOffset + NODE_SIZE)
}

/**
 * Reads a 127-byte quad from a buffer, FR32 pads it, and hashes to produce 2 leaf nodes.
 * Version that writes directly into a nodes array at specific indices.
 *
 * @param {Uint8Array} source - Source data containing the quad
 * @param {number} sourceOffset - Offset into source where quad starts
 * @param {Uint8Array[]} nodes - Array of 32-byte node buffers
 * @param {number} nodeIndex - Starting index in nodes array
 */
export function readQuadToNodes(source, sourceOffset, nodes, nodeIndex) {
  // FR32 pad into reusable buffer
  fr32PadInto(source, sourceOffset, FR32_BUFFER)

  // Hash first 64 bytes → leaf 1
  nodes[nodeIndex] = truncatedHash(FR32_BUFFER.subarray(0, 64))

  // Hash last 64 bytes → leaf 2
  nodes[nodeIndex + 1] = truncatedHash(FR32_BUFFER.subarray(64, 128))
}

/**
 * Calculate the zero-padded size for a given payload size
 *
 * @param {number} payloadSize - Original payload size in bytes
 * @returns {number} - Zero-padded size (multiple of 127)
 */
export function toZeroPaddedSize(payloadSize) {
  const size = Math.max(payloadSize, MIN_PAYLOAD_SIZE)
  const highestBit = Math.floor(Math.log2(size))
  const bound = Math.ceil(FR_RATIO * 2 ** (highestBit + 1))
  return size <= bound ? bound : Math.ceil(FR_RATIO * 2 ** (highestBit + 2))
}

/**
 * Calculate piece size from payload size
 *
 * @param {number} size - Payload size
 * @returns {number} - Piece size after FR32 expansion
 */
export function toPieceSize(size) {
  return toZeroPaddedSize(size) / FR_RATIO
}
