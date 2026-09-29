/**
 * Unsigned varint (LEB128) helpers
 *
 * Uses arithmetic instead of 32-bit bitwise operators so values up to
 * `Number.MAX_SAFE_INTEGER` encode correctly.
 *
 * @module
 */

/**
 * Encodes a number as a varint into the buffer at the given offset
 *
 * @param {number} num - Number to encode
 * @param {Uint8Array} buf - Buffer to write to
 * @param {number} offset - Offset to start writing
 * @returns {number} - Number of bytes written
 */
export function encodeTo(num, buf, offset) {
  let i = offset
  while (num >= 0x80) {
    buf[i++] = (num % 0x80) | 0x80
    num = Math.floor(num / 0x80)
  }
  buf[i++] = num
  return i - offset
}

/**
 * Returns the number of bytes needed to encode a number as varint
 *
 * @param {number} num - Number to measure
 * @returns {number} - Bytes needed
 */
export function encodingLength(num) {
  let len = 1
  while (num >= 0x80) {
    len++
    num = Math.floor(num / 0x80)
  }
  return len
}
