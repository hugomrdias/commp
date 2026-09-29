/**
 * Unsigned varint (LEB128) decoding
 *
 * Uses arithmetic instead of 32-bit bitwise operators so values up to
 * `Number.MAX_SAFE_INTEGER` decode correctly.
 *
 * @module
 */

/**
 * Decodes a varint from the buffer at the given offset
 *
 * @param {Uint8Array} buf - Buffer to read from
 * @param {number} offset - Offset to start reading
 * @returns {[value: number, length: number]} - Decoded value and bytes read
 */
export function decode(buf, offset) {
  let value = 0
  let scale = 1
  let i = offset
  while (buf[i] & 0x80) {
    value += (buf[i] & 0x7f) * scale
    scale *= 0x80
    i++
  }
  value += buf[i] * scale
  return [value, i - offset + 1]
}
