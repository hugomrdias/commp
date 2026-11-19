/**
 * FRC-0069 test vectors
 *
 * @see https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md
 */

import assert from 'node:assert'
import { describe, it } from 'mocha'
import * as CommP from '../src/index.js'
import { vectors } from './frc0069-vectors.js'

describe('@hugomrdias/commp-js FRC-0069 vectors', () => {
  for (const [size, fill, cid, multihash] of vectors) {
    it(`${size} bytes of 0x${fill.toString(16).padStart(2, '0')} -> ${cid}`, () => {
      const result = CommP.digest(new Uint8Array(size).fill(fill))
      assert.strictEqual(Buffer.from(result.bytes).toString('hex'), multihash)
    })
  }

  it('zero-pads payloads shorter than 127 bytes', () => {
    const full = new Uint8Array(127).map((_, i) => i + 1)
    for (let size = 0; size < 127; size++) {
      const padded = new Uint8Array(127)
      padded.set(full.subarray(0, size))
      const short = CommP.digest(full.subarray(0, size))
      assert.deepStrictEqual(
        short.root,
        CommP.digest(padded).root,
        `${size} bytes`
      )
      assert.strictEqual(short.height, 2, `${size} bytes`)
      assert.strictEqual(short.padding, 127 - size, `${size} bytes`)
    }
  })
})
