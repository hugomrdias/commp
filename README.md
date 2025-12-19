# commp

Fast CommP (Filecoin Piece Commitment) implementation in Rust/WASM.

**~4.5x faster** than the original JavaScript implementation, with inline base64 WASM for zero-config usage.

## Benchmarks

| Implementation | MiB/s | Speedup |
|---|---|---|
| Original JS (`@web3-storage/data-segment`) | 13.8 | 1.00x |
| Fast JS (`@webbuf/sha256`) | 38.3 | 2.76x |
| **Rust WASM (inline base64)** | **63.0** | **4.55x** |

## Quick Start

```javascript
// Just import and use - no async init needed!
import { create, root, digest } from "@commp/wasm";

// One-shot API - just get the 32-byte root
const data = new Uint8Array(1024 * 1024).fill(0x42);
const rootHash = root(data); // 32-byte Uint8Array

// Streaming API - for large files or chunked data
const hasher = create();
hasher.write(chunk1);
hasher.write(chunk2);
const result = hasher.digest();
console.log(result.root);    // 32-byte root hash
console.log(result.height);  // tree height
console.log(result.padding); // zero-padding added
hasher.free(); // Free WASM memory when done
```

## Project Structure

```text
commp/
├── rs/commp/                    # Rust WASM crate
│   ├── Cargo.toml
│   └── src/lib.rs
├── ts/
│   ├── npm-commp-wasm/          # @commp/wasm - Rust WASM package
│   │   └── src/
│   │       ├── index.ts         # Main entry point
│   │       └── inline/          # Inline base64 WASM (generated)
│   └── npm-commp-js/            # @commp/js - Pure JS package
│       └── src/
│           ├── index.js         # Main entry point
│           └── ...
├── scripts/
│   └── build-inline-wasm.js     # Converts WASM to inline base64
├── test/
│   ├── commp.test.js            # Mocha tests
│   └── vectors.csv              # Test vectors from storacha/data-segment
└── bench.js                     # Performance benchmarks
```

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)

```bash
# Install Rust (if not installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install wasm-pack
cargo install wasm-pack

# Install Node.js dependencies
pnpm install
```

## Building

### 1. Build Rust to WASM

```bash
cd rs/commp
wasm-pack build --target bundler --out-dir ../../ts/npm-commp-wasm/pkg-bundler --release
```

### 2. Generate Inline Base64 WASM

This embeds the WASM binary as a base64 string for synchronous loading (no async init, works everywhere):

```bash
node scripts/build-inline-wasm.js
```

Output:

```text
WASM binary size: 33508 bytes
Base64 size: 44680 chars
Created: ts/npm-commp-wasm/src/inline/commp_wasm_bg.wasm.js
Created: ts/npm-commp-wasm/src/inline/commp_wasm_bg.js
Created: ts/npm-commp-wasm/src/inline/commp_wasm.js
```

### 3. Build TypeScript Package (optional)

```bash
cd ts/npm-commp-wasm
pnpm install
pnpm build:ts
```

## Usage

Works in Node.js, browsers, Deno, and Bun with no async init required:

```javascript
import { create, root, digest } from "./ts/npm-commp-wasm/src/index.js";

// One-shot: just get the 32-byte root
const data = new Uint8Array(1024 * 1024);
const rootHash = root(data);

// One-shot: get full multihash digest (with metadata)
const result = digest(data);
console.log(result.root);    // 32-byte root hash
console.log(result.height);  // tree height
console.log(result.padding); // zero-padding added

// Streaming: for large files
const hasher = create();
for (const chunk of chunks) {
  hasher.write(chunk);
}
const streamResult = hasher.digest();
hasher.free();
```

## API Reference

### `root(data: Uint8Array): Uint8Array`

Returns the raw **32-byte CommP root hash** (Merkle root of the FR32-padded tree).

Use when you only need the hash itself, e.g., for comparisons or storage.

### `digest(data: Uint8Array): PieceDigest`

Returns a `PieceDigest` object with:

| Field | Type | Description |
|-------|------|-------------|
| `code` | `number` | `0x1011` - multihash identifier |
| `name` | `string` | `"fr32-sha2-256-trunc254-padded-binary-tree"` |
| `bytes` | `Uint8Array` | Full multihash-encoded digest |
| `digest` | `Uint8Array` | Digest payload (padding + height + root) |
| `root` | `Uint8Array` | 32-byte Merkle root |
| `height` | `number` | Tree height (log₂ of leaf count) |
| `padding` | `number` | Zero-padding bytes added |

### `create(): Hasher`

Creates a streaming hasher for processing data in chunks.

#### Hasher methods

- `write(data: Uint8Array): this` - Write data chunk
- `digest(): PieceDigest` - Get full digest result
- `count(): bigint` - Get bytes written
- `reset(): this` - Reset hasher state
- `free(): void` - Free WASM memory (call when done)

## Testing

```bash
# Run all tests (562 test cases)
pnpm test

# Run benchmarks
pnpm bench
```

## How It Works

CommP (Piece Commitment) is a Filecoin-specific hash used to identify data pieces. It involves:

1. **FR32 Padding**: Insert 2 zero bits every 254 bits (127 bytes → 128 bytes)
2. **SHA256 Hashing**: Hash 64-byte chunks with truncation (clear top 2 bits)
3. **Merkle Tree**: Build binary tree, padding with zero commitments

This implementation fuses all three operations in Rust/WASM, eliminating JS↔WASM boundary crossings per hash call.

### Inline Base64 Approach

Following [@webbuf](https://github.com/identellica/webbuf)'s pattern:

1. WASM binary is base64-encoded as a string
2. Decoded and instantiated synchronously at module load
3. No async `init()` needed - just import and use
4. Works everywhere without bundler configuration

## References

- [Filecoin Piece Spec](https://spec.filecoin.io/#section-systems.filecoin_files.piece.data-representation)
- [go-fil-commp-hashhash](https://github.com/filecoin-project/go-fil-commp-hashhash) - Go implementation
- [@web3-storage/data-segment](https://github.com/storacha/data-segment) - Original JS implementation
- [webbuf](https://github.com/identellica/webbuf) - Inline base64 WASM pattern

## License

MIT
