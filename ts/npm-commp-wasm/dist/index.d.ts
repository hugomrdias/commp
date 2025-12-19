/**
 * Fast CommP (Filecoin Piece Commitment) WASM implementation
 *
 * This module provides a high-performance CommP calculation using
 * Rust/WASM for all hot-path operations (FR32 padding, SHA256, tree building).
 *
 * @module @commp/wasm
 */
/**
 * Initialize the WASM module
 *
 * @example
 * ```ts
 * import { init } from '@commp/wasm';
 * await init();
 * ```
 */
export declare function initialize(): Promise<void>;
/** Multihash code for fr32-sha2-256-trunc254-padded-binary-tree */
export declare const code = 4113;
/** Multihash name */
export declare const name: "fr32-sha2-256-trunc254-padded-binary-tree";
/**
 * Piece digest result
 */
export interface PieceDigest {
    /** Multihash code */
    code: number;
    /** Multihash name */
    name: typeof name;
    /** Raw digest bytes (padding + height + root) */
    digest: Uint8Array;
    /** Full multihash bytes */
    bytes: Uint8Array;
    /** Tree height */
    height: number;
    /** 32-byte root hash */
    root: Uint8Array;
    /** Zero padding required */
    padding: number;
}
/**
 * Streaming CommP hasher
 *
 * @example
 * ```ts
 * import { create } from '@commp/wasm';
 *
 * const hasher = create();
 * hasher.write(new Uint8Array(1024).fill(0x42));
 * hasher.write(new Uint8Array(1024).fill(0x43));
 * const digest = hasher.digest();
 * console.log(digest.root); // 32-byte root hash
 * ```
 */
export declare class Hasher {
    private inner;
    constructor();
    /**
     * Get the total number of bytes written
     */
    count(): bigint;
    /**
     * Write bytes into the hasher
     */
    write(bytes: Uint8Array): this;
    /**
     * Compute the digest
     */
    digest(): PieceDigest;
    /**
     * Reset the hasher to initial state
     */
    reset(): this;
    /**
     * Dispose of resources
     */
    dispose(): void;
    /**
     * Free WASM resources (alias for dispose)
     */
    free(): void;
}
/**
 * Creates a new streaming CommP hasher
 *
 * @example
 * ```ts
 * import { create, digest } from '@commp/wasm';
 *
 * // Streaming API
 * const hasher = create();
 * hasher.write(chunk1);
 * hasher.write(chunk2);
 * const result = hasher.digest();
 *
 * // One-shot API
 * const result2 = digest(fullData);
 * ```
 */
export declare function create(): Hasher;
/**
 * Computes CommP digest of a complete payload (one-shot)
 *
 * @example
 * ```ts
 * import { digest } from '@commp/wasm';
 *
 * const data = new Uint8Array(1024 * 1024).fill(0x42);
 * const result = digest(data);
 * console.log(result.root); // 32-byte piece commitment
 * ```
 */
export declare function digest(payload: Uint8Array): PieceDigest;
/**
 * Computes just the 32-byte root hash (faster, less allocations)
 *
 * @example
 * ```ts
 * import { root } from '@commp/wasm';
 *
 * const data = new Uint8Array(1024 * 1024).fill(0x42);
 * const rootHash = root(data);
 * console.log(rootHash); // 32-byte Uint8Array
 * ```
 */
export declare function root(payload: Uint8Array): Uint8Array;
export declare const NODE_SIZE = 32;
export declare const IN_BYTES_PER_QUAD = 127;
export declare const MIN_PAYLOAD_SIZE = 65;
export declare const HEIGHT_SIZE = 1;
export declare const ROOT_SIZE = 32;
//# sourceMappingURL=index.d.ts.map