/**
 * Type definitions for CommP (Filecoin Piece Commitment) implementation
 */

/** A 32-byte merkle tree node */
export type MerkleTreeNode = Uint8Array

/** A layer in the merkle tree containing nodes */
export interface TreeLayer {
  /** Array of 32-byte node buffers */
  nodes: Uint8Array[]
  /** Number of active nodes in this layer */
  count: number
}

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
  /** Free resources (for compatibility) */
  dispose(): void
}

/** Piece digest result */
export interface PieceDigest {
  /** Multihash code */
  code: 0x1011
  /** Multihash name */
  name: 'fr32-sha2-256-trunc254-padded-binary-tree'
  /** Raw digest bytes (height + root) */
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

/** Options for the hasher */
export interface HasherOptions {
  /** Initial capacity hint for number of quads expected */
  capacityHint?: number
}
