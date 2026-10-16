/**
 * @hugomrdias/commp-js SHA-256 tests
 */

import assert from 'node:assert'
import { createHash, randomBytes } from 'node:crypto'
import { describe, it } from 'mocha'
import { sha256x64Into } from '../src/sha256.js'

describe('@hugomrdias/commp-js sha256x64Into', () => {
  it('matches node:crypto for random 64-byte inputs', () => {
    const out = new Uint8Array(32)
    for (let i = 0; i < 1000; i++) {
      const data = randomBytes(64)
      sha256x64Into(data, 0, out, 0)
      const expected = createHash('sha256').update(data).digest()
      assert.deepStrictEqual(Buffer.from(out), expected)
    }
  })

  it('reads and writes at offsets, with overlapping output', () => {
    for (let offset = 0; offset < 32; offset++) {
      const buf = randomBytes(128)
      const input = buf.subarray(offset, offset + 64)
      const expected = createHash('sha256').update(input).digest()
      sha256x64Into(buf, offset, buf, offset + 16)
      assert.deepStrictEqual(buf.subarray(offset + 16, offset + 48), expected)
    }
  })

  it('hashes all-zero and all-ones blocks', () => {
    for (const fill of [0x00, 0xff]) {
      const data = new Uint8Array(64).fill(fill)
      const out = new Uint8Array(32)
      sha256x64Into(data, 0, out, 0)
      const expected = createHash('sha256').update(data).digest()
      assert.deepStrictEqual(Buffer.from(out), expected)
    }
  })
})
