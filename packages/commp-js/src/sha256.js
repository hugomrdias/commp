/**
 * SHA-256 of a 64-byte message in pure JavaScript
 *
 * CommP only hashes 64-byte inputs (two 32-byte nodes), so the message is
 * always one data block followed by the same padding block. The padding
 * block's message schedule is constant and is expanded once at load time.
 *
 * @module
 */

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** Message schedule scratch for the data block */
const W = new Int32Array(64)

/**
 * `W[t] + K[t]` for the padding block of a 64-byte message: 0x80, zeros, and
 * the bit length 512 as a big-endian u64
 */
const PADDING_WK = new Int32Array(64)
PADDING_WK[0] = 0x80000000
PADDING_WK[15] = 512
expand(PADDING_WK)
for (let t = 0; t < 64; t++) PADDING_WK[t] = (PADDING_WK[t] + K[t]) | 0

/**
 * Expand a message schedule in place from its first 16 words
 *
 * @param {Int32Array} w
 */
function expand(w) {
  for (let t = 16; t < 64; t++) {
    const x = w[t - 15]
    const y = w[t - 2]
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
    w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0
  }
}

/**
 * SHA-256 of the 64 bytes of `data` at `offset`, written to `out` at
 * `outOffset`
 *
 * `out` may overlap the input.
 *
 * @param {Uint8Array} data
 * @param {number} offset
 * @param {Uint8Array} out
 * @param {number} outOffset
 */
export function sha256x64Into(data, offset, out, outOffset) {
  for (let i = 0, j = offset; i < 16; i++, j += 4) {
    W[i] =
      (data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3]
  }
  expand(W)

  // Data block, from the initial hash value
  let a = 0x6a09e667
  let b = 0xbb67ae85 | 0
  let c = 0x3c6ef372
  let d = 0xa54ff53a | 0
  let e = 0x510e527f
  let f = 0x9b05688c | 0
  let g = 0x1f83d9ab
  let h = 0x5be0cd19
  for (let t = 0; t < 64; t++) {
    const s1 =
      ((e >>> 6) | (e << 26)) ^
      ((e >>> 11) | (e << 21)) ^
      ((e >>> 25) | (e << 7))
    const ch = (e & f) ^ (~e & g)
    const t1 = (h + s1 + ch + K[t] + W[t]) | 0
    const s0 =
      ((a >>> 2) | (a << 30)) ^
      ((a >>> 13) | (a << 19)) ^
      ((a >>> 22) | (a << 10))
    const maj = (a & b) ^ (a & c) ^ (b & c)
    h = g
    g = f
    f = e
    e = (d + t1) | 0
    d = c
    c = b
    b = a
    a = (t1 + s0 + maj) | 0
  }
  const h0 = (a + 0x6a09e667) | 0
  const h1 = (b + 0xbb67ae85) | 0
  const h2 = (c + 0x3c6ef372) | 0
  const h3 = (d + 0xa54ff53a) | 0
  const h4 = (e + 0x510e527f) | 0
  const h5 = (f + 0x9b05688c) | 0
  const h6 = (g + 0x1f83d9ab) | 0
  const h7 = (h + 0x5be0cd19) | 0

  // Padding block
  a = h0
  b = h1
  c = h2
  d = h3
  e = h4
  f = h5
  g = h6
  h = h7
  for (let t = 0; t < 64; t++) {
    const s1 =
      ((e >>> 6) | (e << 26)) ^
      ((e >>> 11) | (e << 21)) ^
      ((e >>> 25) | (e << 7))
    const ch = (e & f) ^ (~e & g)
    const t1 = (h + s1 + ch + PADDING_WK[t]) | 0
    const s0 =
      ((a >>> 2) | (a << 30)) ^
      ((a >>> 13) | (a << 19)) ^
      ((a >>> 22) | (a << 10))
    const maj = (a & b) ^ (a & c) ^ (b & c)
    h = g
    g = f
    f = e
    e = (d + t1) | 0
    d = c
    c = b
    b = a
    a = (t1 + s0 + maj) | 0
  }

  writeWord(out, outOffset, a + h0)
  writeWord(out, outOffset + 4, b + h1)
  writeWord(out, outOffset + 8, c + h2)
  writeWord(out, outOffset + 12, d + h3)
  writeWord(out, outOffset + 16, e + h4)
  writeWord(out, outOffset + 20, f + h5)
  writeWord(out, outOffset + 24, g + h6)
  writeWord(out, outOffset + 28, h + h7)
}

/**
 * Write a 32-bit word big-endian
 *
 * @param {Uint8Array} out
 * @param {number} offset
 * @param {number} v
 */
function writeWord(out, offset, v) {
  out[offset] = v >>> 24
  out[offset + 1] = v >>> 16
  out[offset + 2] = v >>> 8
  out[offset + 3] = v
}
