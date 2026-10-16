/**
 * workerd (Cloudflare Workers) tests
 *
 * Runs inside workerd, which only compiles WebAssembly from bytes during
 * startup. Test modules are evaluated after startup, like a dynamic import in
 * a deployed Worker, so this fails unless the package resolves its `workerd`
 * entry, which imports the .wasm file instead of the inline base64.
 */

import * as Wasm from '@hugomrdias/commp-wasm'
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
      expect(Wasm.root(data)).toEqual(expected.digest.subarray(-32))
      expect(Wasm.digest(data).bytes).toEqual(expected.bytes)
    })
  }

  it('hashes after a dynamic import', async () => {
    const { root } = await import('@hugomrdias/commp-wasm')
    const data = payload(127)
    expect(root(data)).toEqual(reference(data).digest.subarray(-32))
  })
})
