/**
 * Full-digest differential tests
 *
 * Compares the complete multihash bytes (code, size, padding, height, root)
 * of @commp/js, the raw WASM bindings and the @commp/wasm wrapper against
 * @web3-storage/data-segment as the reference implementation.
 */

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import * as Ref from '@web3-storage/data-segment/multihash'
import { describe, it } from 'mocha'
import * as JS from '../ts/npm-commp-js/src/index.js'
import * as JSVarint from '../ts/npm-commp-js/src/varint.js'
import * as Wasm from '../ts/npm-commp-wasm/src/index.js'
import { CommPHasher } from '../ts/npm-commp-wasm/src/inline/commp_wasm.js'
import * as WasmVarint from '../ts/npm-commp-wasm/src/varint.js'

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toHex(bytes) {
  return Buffer.from(bytes).toString('hex')
}

/**
 * Seeded PRNG (mulberry32) so failures are reproducible
 *
 * @param {number} seed
 * @returns {() => number} - Returns a uint32
 */
function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
}

/**
 * @param {number} size
 * @param {number} seed
 * @returns {Uint8Array}
 */
function randomBytes(size, seed) {
  const next = prng(seed)
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = next() & 0xff
  return bytes
}

/**
 * Split data into seeded random chunks (including empty ones)
 *
 * @param {Uint8Array} data
 * @param {number} seed
 * @returns {Uint8Array[]}
 */
function randomChunks(data, seed) {
  const next = prng(seed)
  const chunks = []
  let offset = 0
  while (offset < data.length) {
    const size = next() % 700
    chunks.push(data.subarray(offset, offset + size))
    offset += size
  }
  return chunks
}

/**
 * @typedef {{ write(bytes: Uint8Array): void, digest(): Uint8Array, reset(): void, free?(): void }} Streaming
 * @typedef {{ name: string, create(): Streaming }} Impl
 */

/** @type {Impl} */
const reference = {
  name: 'data-segment',
  create() {
    let hasher = Ref.create()
    return {
      write: (bytes) => hasher.write(bytes),
      digest: () => hasher.digest().bytes,
      reset: () => {
        hasher = Ref.create()
      },
    }
  },
}

/** @type {Impl[]} */
const impls = [
  {
    name: '@commp/js',
    create() {
      const hasher = JS.create()
      return {
        write: (bytes) => hasher.write(bytes),
        digest: () => hasher.digest().bytes,
        reset: () => hasher.reset(),
      }
    },
  },
  {
    name: '@commp/wasm',
    create() {
      const hasher = Wasm.create()
      return {
        write: (bytes) => hasher.write(bytes),
        digest: () => hasher.digest().bytes,
        reset: () => hasher.reset(),
        free: () => hasher.free(),
      }
    },
  },
  {
    name: 'raw wasm',
    create() {
      const hasher = new CommPHasher()
      return {
        write: (bytes) => hasher.write(bytes),
        digest: () => hasher.digest(),
        reset: () => hasher.reset(),
        free: () => hasher.free(),
      }
    },
  },
]

/**
 * @param {Impl} impl
 * @param {Uint8Array[]} chunks
 * @returns {string}
 */
function digestChunks(impl, chunks) {
  const hasher = impl.create()
  for (const chunk of chunks) hasher.write(chunk)
  const bytes = toHex(hasher.digest())
  hasher.free?.()
  return bytes
}

/**
 * Assert every implementation matches the reference for the given chunks
 *
 * @param {Uint8Array[]} chunks
 */
function assertAllMatch(chunks) {
  const expected = digestChunks(reference, chunks)
  for (const impl of impls) {
    assert.strictEqual(digestChunks(impl, chunks), expected, impl.name)
  }
}

/**
 * Assert that a PieceDigest object is consistent with the reference digest
 *
 * @param {import('../ts/npm-commp-js/src/types.js').PieceDigest} actual
 * @param {ReturnType<typeof Ref.digest>} expected
 */
function assertPieceDigest(actual, expected) {
  assert.strictEqual(toHex(actual.bytes), toHex(expected.bytes), 'bytes')
  assert.strictEqual(toHex(actual.digest), toHex(expected.digest), 'digest')
  assert.strictEqual(toHex(actual.root), toHex(expected.root), 'root')
  assert.strictEqual(actual.height, expected.height, 'height')
  assert.strictEqual(actual.padding, Number(expected.padding), 'padding')
  assert.strictEqual(actual.code, expected.code, 'code')
  assert.strictEqual(actual.name, expected.name, 'name')
}

// Sizes around quad, leaf and power-of-two boundaries
const sizes = new Set([
  0, 1, 2, 31, 32, 33, 63, 64, 65, 66, 96, 97, 126, 127, 128, 129, 253, 254,
  255, 256, 381, 508, 1000, 1016, 1024, 2032,
])
for (let k = 0; k <= 13; k++) {
  for (const base of [127 * 2 ** k, 2 ** k]) {
    for (const delta of [-1, 0, 1]) {
      if (base + delta >= 0) sizes.add(base + delta)
    }
  }
}
const randomSize = prng(0xc0ff33)
for (let i = 0; i < 20; i++) sizes.add(randomSize() % 300_000)
const sortedSizes = [...sizes].sort((a, b) => a - b)

describe('full digest matches data-segment', function () {
  this.timeout(60_000)

  describe('one write', () => {
    for (const size of sortedSizes) {
      it(`${size} bytes`, () => {
        assertAllMatch([randomBytes(size, size)])
      })
    }
  })

  describe('seeded random chunks', () => {
    for (const size of sortedSizes.filter((s) => s >= 64)) {
      it(`${size} bytes`, () => {
        const data = randomBytes(size, size + 1)
        assertAllMatch(randomChunks(data, size))
      })
    }
  })

  describe('PieceDigest fields', () => {
    for (const size of [0, 1, 65, 127, 128, 1000, 65536]) {
      it(`${size} bytes`, () => {
        const data = randomBytes(size, 7)
        const expected = Ref.digest(data)
        assertPieceDigest(JS.digest(data), expected)
        assertPieceDigest(Wasm.digest(data), expected)
        assertPieceDigest(Wasm.create().write(data).digest(), expected)
      })
    }
  })

  // 33,292,289 is one byte past the point where wasm32 usize math overflowed
  it('33,292,289 bytes (past wasm32 usize overflow)', function () {
    this.timeout(120_000)
    const chunk = randomBytes(1 << 20, 99)
    const size = 33_292_289
    const chunks = []
    for (let left = size; left > 0; left -= chunk.length) {
      chunks.push(chunk.subarray(0, Math.min(left, chunk.length)))
    }
    assertAllMatch(chunks)
  })
})

describe('stateful streaming', () => {
  const a = randomBytes(1000, 1)
  const b = randomBytes(5000, 2)

  for (const impl of impls) {
    describe(impl.name, () => {
      it('digest() twice returns the same bytes', () => {
        const hasher = impl.create()
        hasher.write(a)
        const first = toHex(hasher.digest())
        assert.strictEqual(toHex(hasher.digest()), first)
        hasher.free?.()
      })

      it('write → digest → write → digest', () => {
        const hasher = impl.create()
        hasher.write(a)
        assert.strictEqual(toHex(hasher.digest()), digestChunks(reference, [a]))
        hasher.write(b)
        assert.strictEqual(
          toHex(hasher.digest()),
          digestChunks(reference, [a, b]),
        )
        hasher.free?.()
      })

      it('reset then reuse', () => {
        const hasher = impl.create()
        hasher.write(a)
        hasher.digest()
        hasher.reset()
        assert.strictEqual(toHex(hasher.digest()), digestChunks(reference, []))
        hasher.write(b)
        assert.strictEqual(toHex(hasher.digest()), digestChunks(reference, [b]))
        hasher.free?.()
      })
    })
  }
})

describe('vectors.csv sizes', () => {
  const csv = readFileSync(new URL('./vectors.csv', import.meta.url), 'utf-8')
  const [, ...lines] = csv.trim().split('\n')
  const vectors = lines.map((line) => {
    const [contentSize, , paddedSize, pieceSize] = line.split(',')
    return {
      contentSize: Number(contentSize),
      paddedSize: Number(paddedSize),
      pieceSize: Number(pieceSize),
    }
  })
  // Hashing is covered above; only the size fields are checked here
  const seen = new Set()
  for (const { contentSize, paddedSize, pieceSize } of vectors) {
    if (seen.has(contentSize) || contentSize > 1 << 20) continue
    seen.add(contentSize)
    it(`${contentSize} bytes → padded ${paddedSize}, piece ${pieceSize}`, () => {
      const data = new Uint8Array(contentSize)
      for (const result of [JS.digest(data), Wasm.digest(data)]) {
        assert.strictEqual(contentSize + result.padding, paddedSize, 'padded')
        assert.strictEqual(2 ** result.height * 32, pieceSize, 'piece')
      }
    })
  }
})

describe('varint', () => {
  // Expected encodings from multiformats' varint
  const cases = [
    [0, '00'],
    [127, '7f'],
    [128, '8001'],
    [300, 'ac02'],
    [2 ** 31, '8080808008'],
    [2 ** 32, '8080808010'],
    [2 ** 33 + 5, '8580808020'],
    [Number.MAX_SAFE_INTEGER, 'ffffffffffffff0f'],
  ]
  for (const [value, hex] of cases) {
    it(`${value}`, () => {
      const buf = new Uint8Array(10)
      const length = JSVarint.encodeTo(Number(value), buf, 1)
      assert.strictEqual(toHex(buf.subarray(1, 1 + length)), hex, 'encodeTo')
      assert.strictEqual(JSVarint.encodingLength(Number(value)), length)
      assert.deepStrictEqual(WasmVarint.decode(buf, 1), [value, length])
    })
  }
})
