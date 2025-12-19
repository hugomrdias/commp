/**
 * Zero commitment nodes for each tree level
 *
 * These are used when padding the tree to make it complete.
 * Each level's zero node is computed by hashing two zero nodes from the previous level.
 *
 * @module
 */

import { NODE_SIZE } from './constants.js'
import { CONCAT_BUFFER, truncatedHash } from './hash.js'

const MAX_LEVEL = 64

/**
 * Lazy zero-comm buffer which fills up on demand
 */
class ZeroComm {
  constructor() {
    /** @type {Uint8Array} */
    this.bytes = new Uint8Array(MAX_LEVEL * NODE_SIZE)
    // Level 0: empty node (all zeros)
    // Already zeros from initialization
    /** @private @type {Uint8Array} */
    this.node = new Uint8Array(NODE_SIZE) // All zeros
    /** @private */
    this.length = NODE_SIZE
  }

  /**
   * Get a slice of the zero-comm buffer, computing nodes as needed
   *
   * @param {number} start
   * @param {number} end
   * @returns {Uint8Array}
   */
  slice(start, end) {
    while (this.length < end) {
      // Compute next level by hashing current node with itself
      CONCAT_BUFFER.set(this.node, 0)
      CONCAT_BUFFER.set(this.node, NODE_SIZE)
      this.node = truncatedHash(CONCAT_BUFFER)
      this.bytes.set(this.node, this.length)
      this.length += NODE_SIZE
    }
    return this.bytes.subarray(start, end)
  }
}

const ZERO_COMM = new ZeroComm()

/**
 * Get the zero commitment node for a given tree level
 *
 * @example
 * ```ts twoslash
 * import { fromLevel } from './zero-comm.js'
 *
 * // Get zero node for level 0 (leaf level)
 * const zeroLeaf = fromLevel(0)
 *
 * // Get zero node for level 5
 * const zeroNode = fromLevel(5)
 * ```
 *
 * @param {number} level - Tree level (0-63)
 * @returns {Uint8Array} - 32-byte zero commitment node
 * @throws {Error} If level is out of range
 */
export function fromLevel(level) {
  if (level < 0 || level >= MAX_LEVEL) {
    throw new Error(
      `Only levels between 0 and ${MAX_LEVEL - 1} inclusive are available`
    )
  }
  return ZERO_COMM.slice(NODE_SIZE * level, NODE_SIZE * (level + 1))
}
