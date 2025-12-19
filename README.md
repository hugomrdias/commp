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
import { CommPHasher, root } from "@commp/wasm";

// One-shot API
const data = new Uint8Array(1024 * 1024).fill(0x42);
const rootHash = root(data); // 32-byte Uint8Array

// Streaming API
const hasher = new CommPHasher();
hasher.write(chunk1);
hasher.write(chunk2);
const result = hasher.root();
hasher.free(); // Free WASM memory when done
```

## Project Structure

```
commp/
├── rs/commp/                    # Rust WASM crate
│   ├── Cargo.toml
│   └── src/lib.rs
├── ts/npm-commp-wasm/           # TypeScript package
│   └── src/
│       ├── index.ts             # Main entry point
│       └── inline/              # Inline base64 WASM (generated)
│           ├── commp_wasm.js
│           ├── commp_wasm_bg.js
│           └── commp_wasm_bg.wasm.js
├── scripts/
│   └── build-inline-wasm.js     # Converts WASM to inline base64
└── ts/src/commp/                # Pure JS implementation
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
```
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

### `digest(data: Uint8Array): Uint8Array`

Returns the **full multihash-encoded digest** (~38-40 bytes):

```
[code (varint 0x1011), size (varint), padding (varint), height (u8), root (32 bytes)]
```

| Field | Description |
|-------|-------------|
| `code` | `0x1011` - multihash identifier for "fr32-sha256-trunc254-padded-binary-tree" |
| `size` | Total digest payload size |
| `padding` | Zero-padding bytes added to reach power-of-two piece size |
| `height` | Tree height (log₂ of leaf count) |
| `root` | 32-byte Merkle root |

Use when you need the complete Filecoin piece commitment with metadata for on-chain verification.

### `class CommPHasher`

Streaming hasher for processing data in chunks.

- `new CommPHasher()` - Create a new hasher
- `write(data: Uint8Array)` - Write data chunk
- `root(): Uint8Array` - Get 32-byte root hash
- `digest(): Uint8Array` - Get full multihash digest
- `height(): number` - Get tree height
- `count(): bigint` - Get bytes written
- `reset()` - Reset hasher state
- `free()` - Free WASM memory (call when done)

## Testing

```bash
# Test correctness against reference implementations
node commp-wasm-test.js

# Test inline WASM
node test-inline-wasm.js

# Run benchmarks
node tinybench-inline.js
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

