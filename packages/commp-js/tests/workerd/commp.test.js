/**
 * workerd (Cloudflare Workers) tests
 *
 * Runs inside workerd, which only compiles WebAssembly from bytes during
 * startup. Test modules are evaluated after startup, like a dynamic import in
 * a deployed Worker, so this fails if the package, or one of its
 * dependencies, compiles WASM when it is evaluated.
 */

import * as Js from '@hugomrdias/commp-js'
import * as Ref from '@web3-storage/data-segment/multihash'
import { describe, expect, it } from 'vitest'

const SIZES = [65, 127, 1000, (1 << 20) + 1]

/**
 * @param {number} size
 */
function payload(size) {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 31 + 7) & 0xff
  }
  return bytes
}

/**
 * @param {Uint8Array} data
 */
function reference(data) {
  const hasher = Ref.create()
  hasher.write(data)
  return hasher.digest()
}

describe('workerd', () => {
  for (const size of SIZES) {
    it(`matches data-segment for ${size} bytes`, () => {
      const data = payload(size)
      const expected = reference(data)
      const actual = Js.digest(data)
      expect(actual.root).toEqual(expected.digest.subarray(-32))
      expect(actual.bytes).toEqual(expected.bytes)
    })
  }

  it('hashes after a dynamic import', async () => {
    const { digest } = await import('@hugomrdias/commp-js')
    const data = payload(127)
    expect(digest(data).root).toEqual(reference(data).digest.subarray(-32))
  })
})
