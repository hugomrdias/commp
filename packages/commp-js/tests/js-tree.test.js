/**
 * @hugomrdias/commp-js streaming tree tests
 */

import assert from 'node:assert'
import { describe, it } from 'mocha'
import { truncatedHash } from '../src/hash.js'
import { Stack } from '../src/tree.js'
import { fromLevel } from '../src/zero-comm.js'

/**
 * Naive level-by-level tree over level-1 leaves, padding odd levels
 *
 * @param {Uint8Array[]} leaves
 */
function naiveTree(leaves) {
  let level = leaves
  let height = 1
  while (level.length > 1) {
    if (level.length % 2 === 1) level = [...level, fromLevel(height)]
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      const pair = new Uint8Array(64)
      pair.set(level[i], 0)
      pair.set(level[i + 1], 32)
      next.push(truncatedHash(pair))
    }
    level = next
    height++
  }
  return { height, root: level[0] }
}

describe('@hugomrdias/commp-js Stack', () => {
  it('fold matches a naive tree for 2 to 600 leaves', () => {
    const leaves = Array.from({ length: 600 }, (_, i) => {
      const block = new Uint8Array(64)
      new DataView(block.buffer).setUint32(0, i, true)
      return truncatedHash(block)
    })
    const stack = new Stack()
    stack.push(leaves[0])
    for (let n = 2; n <= leaves.length; n++) {
      stack.push(leaves[n - 1])
      const expected = naiveTree(leaves.slice(0, n))
      const actual = stack.fold()
      assert.strictEqual(actual.height, expected.height, `${n} leaves height`)
      assert.deepStrictEqual(actual.root, expected.root, `${n} leaves root`)
    }
  })

  it('fold and clone do not change the stack', () => {
    const stack = new Stack()
    for (let i = 0; i < 5; i++) stack.push(new Uint8Array(32).fill(i))
    const nodes = stack.nodes.slice()
    const filled = stack.filled.slice()
    stack.fold()
    stack.clone().push(new Uint8Array(32))
    assert.deepStrictEqual(stack.nodes, nodes)
    assert.deepStrictEqual(stack.filled, filled)
  })
})
