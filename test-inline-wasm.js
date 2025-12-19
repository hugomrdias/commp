/**
 * Quick test for inline WASM CommP implementation
 */

import { CommPHasher, root } from "./ts/npm-commp-wasm/src/inline/commp_wasm.js";

// Test data
const data = new Uint8Array(1024).fill(0x42);

// Streaming API
const hasher = new CommPHasher();
hasher.write(data);
const streamRoot = new Uint8Array(hasher.root());
hasher.free();

// One-shot API
const oneShotRoot = new Uint8Array(root(data));

console.log("Streaming root:", Buffer.from(streamRoot).toString("hex"));
console.log("One-shot root: ", Buffer.from(oneShotRoot).toString("hex"));

// Known correct value for 1KB of 0x42
const expected = "3c21e1d7893593762fbe0a8f8dbdac16da8dfc6622a43abbc30d1283245cbd34";

const streamHex = Buffer.from(streamRoot).toString("hex");
const oneShotHex = Buffer.from(oneShotRoot).toString("hex");

if (streamHex === expected && oneShotHex === expected) {
  console.log("✅ Inline WASM works correctly!");
  process.exit(0);
} else {
  console.log("❌ Mismatch!");
  console.log("Expected:", expected);
  process.exit(1);
}

