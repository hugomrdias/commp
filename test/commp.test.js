/**
 * CommP inline WASM correctness tests
 *
 * Compares output against @web3-storage/data-segment as reference implementation
 */

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import * as HasherOriginal from '@web3-storage/data-segment/multihash'
import { describe, it } from 'mocha'
import {
  CommPHasher,
  root,
} from '../ts/npm-commp-wasm/src/inline/commp_wasm.js'

/**
 * Convert Uint8Array to hex string
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Get reference CommP root from @web3-storage/data-segment
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function getReferenceRoot(data) {
  const hasher = HasherOriginal.create()
  hasher.write(data)
  const digest = hasher.digest()
  return digest.digest.subarray(-32)
}

/**
 * Get WASM CommP root using streaming API
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function getWasmStreamRoot(data) {
  const hasher = new CommPHasher()
  hasher.write(data)
  const result = new Uint8Array(hasher.root())
  hasher.free()
  return result
}

/**
 * Get WASM CommP root using one-shot API
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function getWasmOneShotRoot(data) {
  return new Uint8Array(root(data))
}

/**
 * Load test vectors from CSV
 * @returns {Array<{contentSize: number, paddedSize: number, pieceSize: number}>}
 */
function loadVectors() {
  const csv = readFileSync(new URL('./vectors.csv', import.meta.url), 'utf-8')
  const [, ...lines] = csv.trim().split('\n')
  return lines.map((line) => {
    const [contentSize, , paddedSize, pieceSize] = line.split(',')
    return {
      contentSize: Number.parseInt(contentSize.trim(), 10),
      paddedSize: Number.parseInt(paddedSize.trim(), 10),
      pieceSize: Number.parseInt(pieceSize.trim(), 10),
    }
  })
}

// Load vectors and dedupe by contentSize (some sizes appear multiple times)
const vectors = loadVectors()
const uniqueSizes = [...new Set(vectors.map((v) => v.contentSize))].sort(
  (a, b) => a - b,
)

describe('CommP inline WASM', function () {
  // Increase timeout for larger data sizes (requires function, not arrow)
  this.timeout(30000)

  describe('streaming API matches reference', () => {
    for (const size of uniqueSizes) {
      it(`${size} bytes`, () => {
        const data = new Uint8Array(size).fill(0x42)
        const expected = getReferenceRoot(data)
        const actual = getWasmStreamRoot(data)
        assert.strictEqual(
          toHex(actual),
          toHex(expected),
          `CommP mismatch for ${size} bytes`,
        )
      })
    }
  })

  describe('one-shot API matches reference', () => {
    for (const size of uniqueSizes) {
      it(`${size} bytes`, () => {
        const data = new Uint8Array(size).fill(0x42)
        const expected = getReferenceRoot(data)
        const actual = getWasmOneShotRoot(data)
        assert.strictEqual(
          toHex(actual),
          toHex(expected),
          `CommP mismatch for ${size} bytes`,
        )
      })
    }
  })

  describe('chunked streaming matches reference', () => {
    const chunkSizes = [127, 256, 1024, 2048, 8192, 65536]
    // Test a subset of sizes for chunked tests (to keep test time reasonable)
    const testSizes = uniqueSizes.filter((s) => s >= 1024 && s <= 1048576)

    for (const chunkSize of chunkSizes) {
      describe(`${chunkSize}B chunks`, () => {
        for (const size of testSizes) {
          it(`${size} bytes`, () => {
            const data = new Uint8Array(size).fill(0x43)

            // Reference (one-shot)
            const expected = getReferenceRoot(data)

            // WASM (chunked)
            const hasher = new CommPHasher()
            for (let i = 0; i < data.length; i += chunkSize) {
              hasher.write(data.subarray(i, i + chunkSize))
            }
            const actual = new Uint8Array(hasher.root())
            hasher.free()

            assert.strictEqual(
              toHex(actual),
              toHex(expected),
              `CommP mismatch for ${size} bytes in ${chunkSize}B chunks`,
            )
          })
        }
      })
    }
  })

  describe('random data', () => {
    const sizes = [1024, 8192, 65536, 262144]

    for (const size of sizes) {
      it(`${size} bytes random`, () => {
        const data = new Uint8Array(size)
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.floor(Math.random() * 256)
        }

        const expected = getReferenceRoot(data)
        const streamActual = getWasmStreamRoot(data)
        const oneShotActual = getWasmOneShotRoot(data)

        assert.strictEqual(
          toHex(streamActual),
          toHex(expected),
          'stream API mismatch',
        )
        assert.strictEqual(
          toHex(oneShotActual),
          toHex(expected),
          'one-shot API mismatch',
        )
      })
    }
  })

  describe('streaming vs one-shot consistency', () => {
    for (const size of uniqueSizes) {
      it(`${size} bytes`, () => {
        const data = new Uint8Array(size).fill(0x44)
        const streamRoot = getWasmStreamRoot(data)
        const oneShotRoot = getWasmOneShotRoot(data)
        assert.strictEqual(
          toHex(streamRoot),
          toHex(oneShotRoot),
          `stream vs one-shot mismatch for ${size} bytes`,
        )
      })
    }
  })
})
