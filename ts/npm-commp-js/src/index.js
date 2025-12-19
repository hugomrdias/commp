/**
 * Fast CommP (Filecoin Piece Commitment) implementation
 *
 * This module provides an optimized pure JavaScript implementation of CommP
 * calculation with WASM-backed SHA256 for maximum throughput.
 *
 * Key optimizations:
 * - Fused FR32 padding and hashing (no intermediate allocations)
 * - Pre-allocated reusable buffers
 * - Index-based tree layer management
 *
 * @module
 */

import {
  CODE_SIZE,
  HEIGHT_SIZE,
  IN_BYTES_PER_QUAD,
  MIN_PAYLOAD_SIZE,
  MULTIHASH_CODE,
  ROOT_SIZE,
} from './constants.js'
import { readQuadToNodes, toZeroPaddedSize } from './fr32.js'
import { build, createLayer, getHeight, getRoot, prune } from './tree.js'

/** @import { StreamingHasher, PieceDigest, TreeLayer } from './types.js' */

/**
 * Encodes a number as a varint into the buffer at the given offset
 *
 * @param {number} num - Number to encode
 * @param {Uint8Array} buf - Buffer to write to
 * @param {number} offset - Offset to start writing
 * @returns {number} - Number of bytes written
 */
function varintEncodeTo(num, buf, offset) {
  let i = offset
  while (num >= 0x80) {
    buf[i++] = (num & 0x7f) | 0x80
    num >>>= 7
  }
  buf[i++] = num
  return i - offset
}

/**
 * Returns the number of bytes needed to encode a number as varint
 *
 * @param {number} num - Number to measure
 * @returns {number} - Bytes needed
 */
function varintEncodingLength(num) {
  let len = 0
  while (num >= 0x80) {
    len++
    num >>>= 7
  }
  return len + 1
}

export { MULTIHASH_CODE as code }
export const name = /** @type {const} */ (
  'fr32-sha2-256-trunc254-padded-binary-tree'
)

/**
 * Maximum digest size in bytes
 */
export const MAX_DIGEST_SIZE = CODE_SIZE + 10 + 10 + HEIGHT_SIZE + ROOT_SIZE

/**
 * Computes the required zero padding for a given payload size
 *
 * @param {bigint} bytesWritten - Number of bytes written
 * @returns {number} - Zero padding required
 */
function requiredZeroPadding(bytesWritten) {
  const size = Number(bytesWritten)
  if (size === 0) return MIN_PAYLOAD_SIZE
  const paddedSize = toZeroPaddedSize(size)
  return paddedSize - size
}

/**
 * Streaming CommP hasher
 *
 * @example
 * ```ts twoslash
 * import { create } from './index.js'
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
     * Total bytes written
     * @private
     * @type {bigint}
     */
    this.bytesWritten = 0n

    /**
     * Buffer for accumulating bytes until we have a full quad (127 bytes)
     * @private
     * @type {Uint8Array}
     */
    this.buffer = new Uint8Array(IN_BYTES_PER_QUAD)

    /**
     * Current offset into the buffer
     * @private
     * @type {number}
     */
    this.offset = 0

    /**
     * Tree layers - layer 0 contains leaves, higher layers contain internal nodes
     * @private
     * @type {TreeLayer[]}
     */
    this.layers = [createLayer()]
  }

  /**
   * Get the total number of bytes written
   *
   * @returns {bigint}
   */
  count() {
    return this.bytesWritten
  }

  /**
   * Write bytes into the hasher
   *
   * @param {Uint8Array} bytes - Bytes to write
   * @returns {this}
   */
  write(bytes) {
    const { buffer, layers } = this
    const leaves = layers[0]
    const length = bytes.length

    if (length === 0) {
      return this
    }

    // If we don't have enough to form a quad, just buffer
    if (this.offset + length < IN_BYTES_PER_QUAD) {
      buffer.set(bytes, this.offset)
      this.offset += length
      this.bytesWritten += BigInt(length)
      return this
    }

    // Fill the buffer to complete a quad
    const bytesRequired = IN_BYTES_PER_QUAD - this.offset
    buffer.set(bytes.subarray(0, bytesRequired), this.offset)

    // Process the full quad - this creates 2 leaves
    readQuadToNodes(buffer, 0, leaves.nodes, leaves.count)
    leaves.count += 2

    // Process remaining full quads directly from input
    let readOffset = bytesRequired
    while (readOffset + IN_BYTES_PER_QUAD <= length) {
      readQuadToNodes(bytes, readOffset, leaves.nodes, leaves.count)
      leaves.count += 2
      readOffset += IN_BYTES_PER_QUAD
    }

    // Buffer remaining bytes
    const remaining = length - readOffset
    if (remaining > 0) {
      buffer.set(bytes.subarray(readOffset), 0)
    }
    this.offset = remaining
    this.bytesWritten += BigInt(length)

    // Prune the tree to keep memory usage low
    prune(layers)

    return this
  }

  /**
   * Compute the digest without modifying hasher state
   *
   * @returns {PieceDigest}
   */
  digest() {
    const { buffer, layers, offset, bytesWritten } = this

    // Clone layers for building
    /** @type {TreeLayer[]} */
    let buildLayers = layers.map((layer) => ({
      nodes: [...layer.nodes],
      count: layer.count,
    }))

    const leaves = buildLayers[0]

    // If we have buffered bytes or no data written, process final quad
    if (offset > 0 || bytesWritten === 0n) {
      // Fill rest of buffer with zeros
      buffer.fill(0, offset)
      readQuadToNodes(buffer, 0, leaves.nodes, leaves.count)
      leaves.count += 2
    }

    // Build the complete tree
    buildLayers = build(buildLayers)

    const height = getHeight(buildLayers)
    const root = getRoot(buildLayers)
    const padding = requiredZeroPadding(bytesWritten)

    // Calculate multihash size
    const paddingLength = varintEncodingLength(padding)
    const digestSize = paddingLength + HEIGHT_SIZE + ROOT_SIZE
    const digestSizeLength = varintEncodingLength(digestSize)
    const totalSize = CODE_SIZE + digestSizeLength + digestSize

    // Build the multihash bytes
    const bytes = new Uint8Array(totalSize)
    let pos = 0

    // Write code
    pos += varintEncodeTo(MULTIHASH_CODE, bytes, pos)

    // Write digest size
    pos += varintEncodeTo(digestSize, bytes, pos)

    // Write padding
    pos += varintEncodeTo(padding, bytes, pos)

    // Write height
    bytes[pos] = height
    pos += HEIGHT_SIZE

    // Write root
    bytes.set(root, pos)

    // Extract raw digest (padding + height + root)
    const digest = bytes.subarray(CODE_SIZE + digestSizeLength)

    return {
      code: MULTIHASH_CODE,
      name,
      digest,
      bytes,
      height,
      root,
      padding,
    }
  }

  /**
   * Reset the hasher to initial state
   *
   * @returns {this}
   */
  reset() {
    this.offset = 0
    this.bytesWritten = 0n
    this.layers = [createLayer()]
    return this
  }

  /**
   * Dispose of resources (for compatibility)
   */
  dispose() {
    this.reset()
  }
}

/**
 * Creates a new streaming CommP hasher
 *
 * @example
 * ```ts twoslash
 * import { create, digest } from './index.js'
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
 * Computes CommP digest of a complete payload
 *
 * @example
 * ```ts twoslash
 * import { digest } from './index.js'
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
  hasher.write(payload)
  return hasher.digest()
}

// Re-export constants for consumers
export {
  HEIGHT_SIZE,
  IN_BYTES_PER_QUAD,
  MIN_PAYLOAD_SIZE,
  NODE_SIZE,
  ROOT_SIZE,
} from './constants.js'

export { MAX_DIGEST_SIZE as MAX_SIZE }
