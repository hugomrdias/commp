/**
 * Correctness tests for fast CommP implementation
 *
 * Compares output against @web3-storage/data-segment and WASM implementations
 */

import * as HasherOriginal from "@web3-storage/data-segment/multihash";
import * as HasherWasm from "fr32-sha2-256-trunc254-padded-binary-tree-multihash";
import * as HasherFast from "./ts/src/commp/index.js";

/**
 * Convert Uint8Array to hex string for comparison
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toHex(bytes) {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Compare two Uint8Arrays
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {boolean}
 */
function arraysEqual(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/**
 * Run test with given data
 * @param {string} name
 * @param {Uint8Array} data
 */
function runTest(name, data) {
	console.log(`\n=== Test: ${name} (${data.length} bytes) ===`);

	// Original JS implementation
	const originalHasher = HasherOriginal.create();
	originalHasher.write(data);
	const originalDigest = originalHasher.digest();
	console.log("Original root:", toHex(originalDigest.digest.subarray(-32)));

	// Fast JS implementation
	const fastHasher = HasherFast.create();
	fastHasher.write(data);
	const fastDigest = fastHasher.digest();
	console.log("Fast root:    ", toHex(fastDigest.root));

	// WASM implementation
	const wasmHasher = HasherWasm.create();
	wasmHasher.write(data);
	const wasmDigestBytes = new Uint8Array(wasmHasher.multihashByteLength());
	wasmHasher.digestInto(wasmDigestBytes, 0, true);
	wasmHasher.free();
	// Extract root from WASM (last 32 bytes of multihash)
	const wasmRoot = wasmDigestBytes.subarray(-32);
	console.log("WASM root:    ", toHex(wasmRoot));

	// Compare roots
	const originalRoot = originalDigest.digest.subarray(-32);
	const fastMatchesOriginal = arraysEqual(fastDigest.root, originalRoot);
	const fastMatchesWasm = arraysEqual(fastDigest.root, wasmRoot);

	console.log(
		"Fast matches Original:",
		fastMatchesOriginal ? "✓ PASS" : "✗ FAIL",
	);
	console.log("Fast matches WASM:", fastMatchesWasm ? "✓ PASS" : "✗ FAIL");

	if (!fastMatchesOriginal || !fastMatchesWasm) {
		throw new Error(`Test failed: ${name}`);
	}

	return true;
}

/**
 * Run chunked test
 * @param {string} name
 * @param {Uint8Array} data
 * @param {number} chunkSize
 */
function runChunkedTest(name, data, chunkSize) {
	console.log(
		`\n=== Chunked Test: ${name} (${data.length} bytes, ${chunkSize}B chunks) ===`,
	);

	// Original - one shot
	const originalHasher = HasherOriginal.create();
	originalHasher.write(data);
	const originalDigest = originalHasher.digest();

	// Fast - chunked
	const fastHasher = HasherFast.create();
	for (let i = 0; i < data.length; i += chunkSize) {
		fastHasher.write(data.subarray(i, i + chunkSize));
	}
	const fastDigest = fastHasher.digest();

	const originalRoot = originalDigest.digest.subarray(-32);
	const match = arraysEqual(fastDigest.root, originalRoot);

	console.log("Original root:", toHex(originalRoot));
	console.log("Fast root:    ", toHex(fastDigest.root));
	console.log("Match:", match ? "✓ PASS" : "✗ FAIL");

	if (!match) {
		throw new Error(`Chunked test failed: ${name}`);
	}

	return true;
}

// Run tests
console.log("CommP Implementation Correctness Tests\n");
console.log("=".repeat(50));

try {
	// Edge cases
	runTest("Min size (65 bytes)", new Uint8Array(65).fill(0x42));
	runTest("127 bytes (one quad)", new Uint8Array(127).fill(0x42));
	runTest("128 bytes (one quad + 1)", new Uint8Array(128).fill(0x42));
	runTest("254 bytes (two quads)", new Uint8Array(254).fill(0x42));

	// Common sizes
	runTest("1 KB", new Uint8Array(1024).fill(0x42));
	runTest("8 KB", new Uint8Array(8 * 1024).fill(0x42));
	runTest("64 KB", new Uint8Array(64 * 1024).fill(0x42));
	runTest("1 MB", new Uint8Array(1024 * 1024).fill(0x42));

	// Chunked tests
	runChunkedTest(
		"1 MB in 127B chunks",
		new Uint8Array(1024 * 1024).fill(0x43),
		127,
	);
	runChunkedTest(
		"1 MB in 2KB chunks",
		new Uint8Array(1024 * 1024).fill(0x43),
		2048,
	);
	runChunkedTest(
		"1 MB in 64KB chunks",
		new Uint8Array(1024 * 1024).fill(0x43),
		65536,
	);

	// Random data
	const randomData = new Uint8Array(100 * 1024);
	for (let i = 0; i < randomData.length; i++) {
		randomData[i] = Math.floor(Math.random() * 256);
	}
	runTest("100 KB random", randomData);

	console.log("\n" + "=".repeat(50));
	console.log("All tests passed! ✓");
	process.exit(0);
} catch (err) {
	console.error("\n" + "=".repeat(50));
	console.error("Tests failed:", err.message);
	process.exit(1);
}
