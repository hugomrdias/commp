/**
 * CLI around @commp/wasm for compare/run.js
 *
 * Same commands and output formats as compare/go/main.go (see there), minus
 * `gen`, whose Lotus payloads come from the Go CLI.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { create } from '../packages/commp-wasm/src/index.js'

const pkg = new URL('../packages/commp-wasm/', import.meta.url)

/** Stdin is fed to the hasher in this cycle of sizes to exercise partial quads */
const READ_SIZES = [1, 31, 127, 128, 1000, 4096, 65536, 1 << 20]

const [command, ...args] = process.argv.slice(2)
const num = (/** @type {number} */ i) => Number(args[i])

function info() {
  return {
    impl: 'wasm',
    backend: 'wasm simd128, 4 messages per SHA-256',
    runtime: `node ${process.version} (V8 ${process.versions.v8})`,
    os: process.platform,
    arch: process.arch,
    deps: {
      '@commp/wasm': JSON.parse(
        readFileSync(new URL('package.json', pkg), 'utf8')
      ).version,
      // The package version rarely changes; this pins the exact binary
      'inline wasm sha256': createHash('sha256')
        .update(readFileSync(new URL('src/inline/commp_wasm_bg.wasm.js', pkg)))
        .digest('hex')
        .slice(0, 16),
    },
  }
}

/** Buffered stdin that hands out exact byte counts */
class Input {
  constructor() {
    this.chunks = process.stdin[Symbol.asyncIterator]()
    /** @type {Uint8Array} */
    this.pending = new Uint8Array(0)
    this.done = false
  }

  /**
   * Read up to `n` bytes, fewer only at end of input
   *
   * @param {number} n
   */
  async read(n) {
    if (this.pending.length < n && !this.done) {
      const parts = [this.pending]
      let length = this.pending.length
      while (length < n) {
        const next = await this.chunks.next()
        if (next.done) {
          this.done = true
          break
        }
        parts.push(next.value)
        length += next.value.length
      }
      this.pending = Buffer.concat(parts, length)
    }
    const out = this.pending.subarray(0, n)
    this.pending = this.pending.subarray(out.length)
    return out
  }
}

/**
 * Hash `limit` bytes of `input` (or to EOF), reading in the READ_SIZES cycle
 *
 * @param {Input} input
 * @param {number} [limit]
 */
async function hashInput(input, limit = Number.POSITIVE_INFINITY) {
  const hasher = create()
  try {
    for (let i = 0; limit > 0; i++) {
      const n = Math.min(READ_SIZES[i % READ_SIZES.length], limit)
      const bytes = await input.read(n)
      hasher.write(bytes)
      limit -= bytes.length
      if (bytes.length < n) {
        if (limit > 0 && limit !== Number.POSITIVE_INFINITY) {
          fail('unexpected end of input')
        }
        break
      }
    }
    return result(hasher)
  } finally {
    hasher.free()
  }
}

/** @param {ReturnType<typeof create>} hasher */
function result(hasher) {
  const { root, height } = hasher.digest()
  return { root: Buffer.from(root).toString('hex'), padded: 32 * 2 ** height }
}

async function frames() {
  const input = new Input()
  const lines = []
  for (;;) {
    const header = await input.read(8)
    if (header.length === 0) break
    if (header.length < 8) fail('truncated frame header')
    const size = Number(Buffer.from(header).readBigUInt64LE())
    const { root, padded } = await hashInput(input, size)
    lines.push(`${root} ${padded}\n`)
  }
  process.stdout.write(lines.join(''))
}

/**
 * xorshift32 (13, 17, 5) from seed 0x9E3779B9, little-endian words
 *
 * @param {number} size
 */
function xorshiftBuffer(size) {
  const words = new Uint32Array(Math.ceil(size / 4))
  let x = 0x9e3779b9
  for (let i = 0; i < words.length; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    words[i] = x >>> 0
  }
  // Uint32Array is platform-endian; every supported platform is little-endian
  return new Uint8Array(words.buffer, 0, size)
}

/**
 * Hash `size` bytes of `buf` repeated, written `chunk` bytes at a time
 *
 * @param {Uint8Array} buf
 * @param {number} size
 * @param {number} chunk
 */
function hashBuffer(buf, size, chunk) {
  const hasher = create()
  for (let off = 0; off < size; ) {
    const pos = off % buf.length
    const n = Math.min(chunk, buf.length - pos, size - off)
    hasher.write(buf.subarray(pos, pos + n))
    off += n
  }
  const out = result(hasher)
  hasher.free()
  return out
}

/**
 * @param {number} size
 * @param {number} iters
 * @param {number} bufSize
 * @param {number} chunk
 */
function bench(size, iters, bufSize, chunk) {
  const buf = xorshiftBuffer(bufSize)
  // Warm up the JIT, caches and the CPU clock
  hashBuffer(buf, Math.min(size, 8 << 20), chunk)
  const rssBase = process.resourceUsage().maxRSS * 1024

  let out = { root: '', padded: 0 }
  const runs = []
  for (let i = 0; i < iters; i++) {
    const cpu0 = process.cpuUsage()
    const start = process.hrtime.bigint()
    out = hashBuffer(buf, size, chunk)
    const wall = Number(process.hrtime.bigint() - start) / 1e9
    const cpu = process.cpuUsage(cpu0)
    runs.push({
      wall,
      user: cpu.user / 1e6,
      sys: cpu.system / 1e6,
      allocBytes: null,
      allocs: null,
    })
  }

  return {
    ...info(),
    size,
    chunk,
    buf: bufSize,
    ...out,
    rssBase,
    rssPeak: process.resourceUsage().maxRSS * 1024,
    runs,
  }
}

/** @param {string} msg */
function fail(msg) {
  process.stderr.write(`commp-wasm: ${msg}\n`)
  process.exit(1)
}

switch (command) {
  case 'info':
    console.log(JSON.stringify(info()))
    break
  case 'hash': {
    const { root, padded } = await hashInput(new Input())
    console.log(`${root} ${padded}`)
    break
  }
  case 'frames':
    await frames()
    break
  case 'bench':
    console.log(JSON.stringify(bench(num(0), num(1), num(2), num(3))))
    break
  default:
    fail('usage: node compare/wasm.js <info|hash|frames|bench> ...')
}
