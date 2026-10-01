/* tslint:disable */
/* eslint-disable */

export class CommPHasher {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new hasher
   */
  constructor();
  /**
   * Get just the 32-byte CommP root hash
   * 
   * Returns the raw Merkle root without multihash encoding.
   * Use `digest()` if you need the full multihash with metadata.
   */
  root(): Uint8Array;
  /**
   * Get bytes written count
   */
  count(): bigint;
  /**
   * Reset the hasher for reuse
   */
  reset(): void;
  /**
   * Write bytes into the hasher
   *
   * Throws a `RangeError` (without changing the hasher) if the total would
   * exceed `MAX_PAYLOAD_SIZE`.
   */
  write(bytes: Uint8Array): void;
  /**
   * Get the full multihash-encoded digest
   * 
   * Returns: [code (varint 0x1011), size (varint), padding (varint), height (u8), root (32 bytes)]
   * 
   * - `code`: 0x1011 = "fr32-sha256-trunc254-padded-binary-tree" multihash identifier
   * - `size`: total digest size (padding_len + 1 + 32)
   * - `padding`: bytes of zero-padding added to reach next power-of-two piece size  
   * - `height`: tree height (log2 of piece size / 32)
   * - `root`: 32-byte Merkle root
   */
  digest(): Uint8Array;
  /**
   * Get the tree height
   */
  height(): number;
}

/**
 * One-shot digest: returns full multihash-encoded CommP
 * 
 * Format: [code (varint 0x1011), size (varint), padding (varint), height (u8), root (32 bytes)]
 * 
 * Use this when you need the complete Filecoin piece commitment with metadata.
 * The multihash code 0x1011 identifies this as "fr32-sha256-trunc254-padded-binary-tree".
 */
export function digest(data: Uint8Array): Uint8Array;

/**
 * One-shot root: returns just the 32-byte CommP root hash
 * 
 * Use this when you only need the raw hash without multihash encoding.
 * This is the Merkle root of the FR32-padded, SHA256-hashed binary tree.
 */
export function root(data: Uint8Array): Uint8Array;
