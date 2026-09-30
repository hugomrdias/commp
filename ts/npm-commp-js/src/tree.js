/**
 * Streaming merkle tree with O(log n) memory
 *
 * Keeps one pending node per tree level, merged like a binary counter as
 * leaves are pushed, in a single flat buffer.
 *
 * @module
 */

import { NODE_SIZE } from './constants.js'
import { CONCAT_BUFFER, truncatedHashInto } from './hash.js'
import { fromLevel as zeroFromLevel } from './zero-comm.js'

/** Maximum tree levels */
const MAX_LEVEL = 64

/**
 * Hash `left || right` into `out` at `outOffset`. Both inputs are copied
 * before hashing, so `out` may overlap either of them.
 *
 * @param {Uint8Array} left - 32-byte node
 * @param {Uint8Array} right - 32-byte node
 * @param {Uint8Array} out
 * @param {number} outOffset
 */
function hashPairInto(left, right, out, outOffset) {
  CONCAT_BUFFER.set(left, 0)
  CONCAT_BUFFER.set(right, NODE_SIZE)
  truncatedHashInto(CONCAT_BUFFER, out, outOffset)
}

/**
 * Pending subtree roots, one per level
 *
 * `filled[k]` is set when `nodes` holds, at slot `k`, the root of a complete
 * subtree of `2^k` leaves that is still waiting for its right sibling. Slot
 * `k` is a node at tree level `k + 1`: our leaves hash 64-byte halves of a
 * quad, so they are level 1 of the reference tree (level 0 is the raw 32-byte
 * FR32 chunks).
 */
export class Stack {
  constructor() {
    /** Pending nodes, `NODE_SIZE` bytes per level */
    this.nodes = new Uint8Array(MAX_LEVEL * NODE_SIZE)
    /** Whether each level holds a pending node */
    this.filled = new Uint8Array(MAX_LEVEL)
    /** Scratch node carried upward by `push` */
    this.carry = new Uint8Array(NODE_SIZE)
  }

  /**
   * Copy the stack, so a digest can finish the tree without changing it
   *
   * @returns {Stack}
   */
  clone() {
    const copy = new Stack()
    copy.nodes.set(this.nodes)
    copy.filled.set(this.filled)
    return copy
  }

  /**
   * Remove all pending nodes
   */
  clear() {
    this.filled.fill(0)
  }

  /**
   * Push a leaf, merging completed subtrees upward
   *
   * @param {Uint8Array} leaf - 32-byte leaf (copied)
   */
  push(leaf) {
    const { nodes, filled, carry } = this
    carry.set(leaf)
    let level = 0
    while (filled[level]) {
      hashPairInto(
        nodes.subarray(level * NODE_SIZE, (level + 1) * NODE_SIZE),
        carry,
        carry,
        0,
      )
      filled[level] = 0
      level++
    }
    nodes.set(carry, level * NODE_SIZE)
    filled[level] = 1
  }

  /**
   * Fold pending nodes into the root, padding with zero commitments
   *
   * Requires at least two leaves. Does not modify the stack.
   *
   * @returns {{ height: number, root: Uint8Array }}
   */
  fold() {
    const { nodes, filled } = this
    const lowest = filled.indexOf(1)
    const top = filled.lastIndexOf(1)
    const node = (/** @type {number} */ level) =>
      nodes.subarray(level * NODE_SIZE, (level + 1) * NODE_SIZE)

    if (lowest === top) {
      return { height: top + 1, root: node(top).slice() }
    }

    // Carry the right-most partial subtree up to the level of `top`,
    // pairing it with a pending left sibling or a zero commitment
    const acc = new Uint8Array(NODE_SIZE)
    hashPairInto(node(lowest), zeroFromLevel(lowest + 1), acc, 0)
    for (let level = lowest + 1; level < top; level++) {
      if (filled[level]) {
        hashPairInto(node(level), acc, acc, 0)
      } else {
        hashPairInto(acc, zeroFromLevel(level + 1), acc, 0)
      }
    }
    hashPairInto(node(top), acc, acc, 0)
    return { height: top + 2, root: acc }
  }
}
