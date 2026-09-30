/**
 * Full-digest differential tests
 *
 * Compares the complete multihash bytes (code, size, padding, height, root)
 * of @hugomrdias/commp-js, the raw WASM bindings and the @hugomrdias/commp-wasm wrapper against
 * @web3-storage/data-segment as the reference implementation.
 */

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import * as JS from '@hugomrdias/commp-js'
import * as Ref from '@web3-storage/data-segment/multihash'
import { describe, it } from 'mocha'
import * as JSVarint from '../../commp-js/src/varint.js'
import * as Wasm from '../src/index.js'
import { CommPHasher } from '../src/inline/commp_wasm.js'
import { wasm } from '../src/inline/commp_wasm_bg.wasm.js'
import * as WasmVarint from '../src/varint.js'

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
    name: '@hugomrdias/commp-js',
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
    name: '@hugomrdias/commp-wasm',
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
 * @param {import('../../commp-js/src/types.js').PieceDigest} actual
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
// Around WASM batch boundaries (128 quads = 16,256 bytes)
for (let k = 1; k <= 4; k++) {
  for (const delta of [-128, -127, -1, 0, 1, 127]) sizes.add(16_256 * k + delta)
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

  // The wrapper feeds inputs over 1 MiB to WASM in 1 MiB chunks, which
  // aren't a multiple of 127, so quads straddle chunks
  it('@hugomrdias/commp-wasm one-shot over the 1 MiB chunk size', () => {
    const data = randomBytes(5 * (1 << 20) + 1000, 11)
    const expected = Ref.digest(data)
    assertPieceDigest(Wasm.digest(data), expected)
    assert.strictEqual(toHex(Wasm.root(data)), toHex(expected.root))
    assert.strictEqual(
      toHex(Wasm.create().write(data).digest().bytes),
      toHex(expected.bytes)
    )
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

describe('inline wasm loader', () => {
  const loaderUrl = new URL(
    '../src/inline/commp_wasm_bg.wasm.js',
    import.meta.url
  )
  const fromBase64 = Uint8Array.fromBase64
  const NodeBuffer = globalThis.Buffer

  /**
   * Load a fresh copy of the loader and check the decoded module matches
   *
   * @param {string} name
   */
  async function load(name) {
    const fresh = await import(`${loaderUrl}?${name}`)
    assert.ok(fresh.wasm.memory instanceof WebAssembly.Memory)
  }

  it('decodes without Uint8Array.fromBase64 (Buffer)', async () => {
    try {
      delete Uint8Array.fromBase64
      await load('buffer')
    } finally {
      Uint8Array.fromBase64 = fromBase64
    }
  })

  it('decodes without fromBase64 or Buffer (atob)', async () => {
    try {
      delete Uint8Array.fromBase64
      delete globalThis.Buffer
      await load('atob')
    } finally {
      Uint8Array.fromBase64 = fromBase64
      globalThis.Buffer = NodeBuffer
    }
  })
})

describe('wasm memory', () => {
  it('one-shot digest and root of 64 MiB grow memory by at most a chunk', function () {
    this.timeout(60_000)
    const data = new Uint8Array(64 << 20).fill(3)
    const before = wasm.memory.buffer.byteLength
    Wasm.digest(data)
    Wasm.root(data)
    assert.ok(
      wasm.memory.buffer.byteLength - before <= 2 << 20,
      `grew by ${wasm.memory.buffer.byteLength - before} bytes`
    )
  })

  it('stays constant while streaming 256 MiB', function () {
    this.timeout(60_000)
    const chunk = randomBytes(1 << 20, 5)
    const hasher = new CommPHasher()
    // The first write may grow memory to fit the chunk copy
    hasher.write(chunk)
    const before = wasm.memory.buffer.byteLength
    for (let i = 1; i < 256; i++) hasher.write(chunk)
    hasher.digest()
    assert.strictEqual(wasm.memory.buffer.byteLength, before)
    hasher.free()
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
          digestChunks(reference, [a, b])
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

describe('MAX_PAYLOAD_SIZE', () => {
  it('is 127 * 2^47 in both packages', () => {
    assert.strictEqual(JS.MAX_PAYLOAD_SIZE, 127n * 2n ** 47n)
    assert.strictEqual(Wasm.MAX_PAYLOAD_SIZE, JS.MAX_PAYLOAD_SIZE)
  })

  it('@hugomrdias/commp-js throws RangeError and leaves the hasher unchanged', () => {
    const hasher = JS.create()
    // @ts-expect-error private field, to avoid writing ~16 PiB
    hasher.bytesWritten = JS.MAX_PAYLOAD_SIZE - 10n
    assert.throws(() => hasher.write(new Uint8Array(11)), {
      name: 'RangeError',
      message: `Writing 11 bytes exceeds max payload size of ${JS.MAX_PAYLOAD_SIZE}`,
    })
    assert.strictEqual(hasher.count(), JS.MAX_PAYLOAD_SIZE - 10n)
    hasher.write(new Uint8Array(10))
    assert.strictEqual(hasher.count(), JS.MAX_PAYLOAD_SIZE)
    assert.throws(() => hasher.write(new Uint8Array(1)), RangeError)
    hasher.write(new Uint8Array(0))
  })

  it('@hugomrdias/commp-wasm rejects a multi-chunk write before writing any chunk', () => {
    const hasher = Wasm.create()
    hasher.count = () => Wasm.MAX_PAYLOAD_SIZE - 10n
    assert.throws(() => hasher.write(new Uint8Array(3 << 20)), {
      name: 'RangeError',
      message: `Writing ${3 << 20} bytes exceeds max payload size of ${Wasm.MAX_PAYLOAD_SIZE}`,
    })
    // @ts-expect-error private field
    assert.strictEqual(hasher.inner.count(), 0n)
    hasher.free()
  })
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
