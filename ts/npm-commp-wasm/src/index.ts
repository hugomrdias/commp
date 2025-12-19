/**
 * Fast CommP (Filecoin Piece Commitment) WASM implementation
 *
 * This module provides a high-performance CommP calculation using
 * Rust/WASM with inline base64 encoding - no async init required.
 *
 * @module @commp/wasm
 */

// Import inline WASM module (synchronously initialized)
import {
	CommPHasher as WasmHasher,
	root as wasmRoot,
	// @ts-expect-error - inline wasm module is generated, no .d.ts
} from "./inline/commp_wasm.js";

/** Multihash code for fr32-sha2-256-trunc254-padded-binary-tree */
export const code = 0x1011;

/** Multihash name */
export const name = "fr32-sha2-256-trunc254-padded-binary-tree" as const;

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
export class Hasher {
	private inner: WasmHasher;

	constructor() {
		this.inner = new WasmHasher();
	}

	/**
	 * Get the total number of bytes written
	 */
	count(): bigint {
		return BigInt(this.inner.count());
	}

	/**
	 * Write bytes into the hasher
	 */
	write(bytes: Uint8Array): this {
		this.inner.write(bytes);
		return this;
	}

	/**
	 * Compute the digest
	 */
	digest(): PieceDigest {
		const bytes = this.inner.digest();
		const root = this.inner.root();
		const height = this.inner.height();

		// Parse padding from multihash bytes
		// Format: code (varint) | size (varint) | padding (varint) | height | root
		let pos = 0;
		// Skip code
		while (bytes[pos] & 0x80) pos++;
		pos++;
		// Skip size
		while (bytes[pos] & 0x80) pos++;
		pos++;
		// Read padding
		let padding = 0;
		let shift = 0;
		while (bytes[pos] & 0x80) {
			padding |= (bytes[pos] & 0x7f) << shift;
			shift += 7;
			pos++;
		}
		padding |= bytes[pos] << shift;
		pos++;

		// Digest is from pos-padding_len to end
		const digestStart = pos - (shift / 7 + 1);
		const digest = bytes.slice(digestStart);

		return {
			code,
			name,
			digest: new Uint8Array(digest),
			bytes: new Uint8Array(bytes),
			height,
			root: new Uint8Array(root),
			padding,
		};
	}

	/**
	 * Reset the hasher to initial state
	 */
	reset(): this {
		this.inner.reset();
		return this;
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		this.inner.free();
	}

	/**
	 * Free WASM resources (alias for dispose)
	 */
	free(): void {
		this.inner.free();
	}
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
export function create(): Hasher {
	return new Hasher();
}

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
export function digest(payload: Uint8Array): PieceDigest {
	const hasher = create();
	hasher.write(payload);
	const result = hasher.digest();
	hasher.free();
	return result;
}

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
export function root(payload: Uint8Array): Uint8Array {
	return new Uint8Array(wasmRoot(payload));
}

// Re-export constants
export const NODE_SIZE = 32;
export const IN_BYTES_PER_QUAD = 127;
export const MIN_PAYLOAD_SIZE = 65;
export const HEIGHT_SIZE = 1;
export const ROOT_SIZE = 32;
