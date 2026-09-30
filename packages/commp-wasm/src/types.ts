/**
 * Type definitions for CommP WASM implementation
 */

/** Streaming hasher interface */
export interface StreamingHasher {
  /** Write bytes into the hasher */
  write(bytes: Uint8Array): this
  /** Get the total bytes written */
  count(): bigint
  /** Compute the digest without consuming the hasher */
  digest(): PieceDigest
  /** Reset the hasher to initial state */
  reset(): this
  /** Free resources */
  dispose(): void
  /** Free WASM resources (alias for dispose) */
  free(): void
}

/** Piece digest result */
export interface PieceDigest {
  /** Multihash code */
  code: 0x1011
  /** Multihash name */
  name: 'fr32-sha2-256-trunc254-padded-binary-tree'
  /** Raw digest bytes (padding + height + root) */
  digest: Uint8Array
  /** Full multihash bytes (code + size + digest) */
  bytes: Uint8Array
  /** Tree height */
  height: number
  /** 32-byte root hash */
  root: Uint8Array
  /** Zero padding applied */
  padding: number
}
