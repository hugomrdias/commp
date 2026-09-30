# commp

Fast CommP (Filecoin Piece Commitment) implementation in Rust/WASM.

Up to **~15x faster** than the original JavaScript implementation in Node (**~11–34x** in browsers), with inline base64 WASM for zero-config usage. The WASM build hashes 4 SHA-256 messages at once with SIMD and streams with O(log n) memory.

## Benchmarks

### Node

Node 26, Apple Silicon, 1 MiB streaming (`pnpm bench`):

| Implementation | MiB/s | Speedup |
|---|---|---|
| Original JS (`@web3-storage/data-segment`) | 11.8 | 1.00x |
| Fast JS (`@webbuf/sha256`) | 41.4 | 3.52x |
| **Rust WASM (inline base64)** | **181.2** | **15.38x** |

### Browsers

Apple Silicon, 1 MiB streaming, via [playwright-test](https://github.com/hugomrdias/playwright-test) (`pnpm bench:browser --browser <name>`):

| Implementation | Chromium 153 | Firefox 155 | WebKit (Safari 26.6) |
| --- | --- | --- | --- |
| Original JS (`@web3-storage/data-segment`) | 7.5 | 5.0 | 16.5 |
| Fast JS (`@webbuf/sha256`) | 43.8 | 31.7 | 36.4 |
| **Rust WASM (inline base64)** | **185.6** | **170.7** | **187.3** |
| WASM speedup vs original | 24.8x | 34.2x | 11.3x |

### Native and Go

[compare/](compare/README.md) checks the native Rust and WASM builds against
[go-fil-commp-hashhash](https://github.com/filecoin-project/go-fil-commp-hashhash)
for correctness, speed and memory. It runs with SHA extensions on and off, and
writes one results file per machine (`pnpm compare`).

## Quick Start

```javascript
// Just import and use - no async init needed!
import { create, root, digest } from "@hugomrdias/commp-wasm";

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

A pnpm workspace orchestrated with [Turborepo](https://turborepo.com), released with [release-please](https://github.com/googleapis/release-please).

```text
commp/
├── packages/
│   ├── commp-wasm/                  # @hugomrdias/commp-wasm - Rust WASM package
│   │   ├── src/
│   │   │   ├── index.js             # Main entry point
│   │   │   └── inline/              # Inline base64 WASM (generated, committed)
│   │   ├── scripts/
│   │   │   └── build-inline-wasm.js # Converts WASM to inline base64
│   │   └── tests/                   # Vector and differential tests vs data-segment
│   ├── commp-js/                    # @hugomrdias/commp-js - Pure JS package
│   │   ├── src/
│   │   └── tests/
│   └── bench/                       # Benchmarks (private, not published)
├── rs/commp/                        # Rust WASM crate
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs                   # Crate setup, constants, one-shot digest/root
│   │   ├── hasher.rs                # Streaming CommPHasher
│   │   ├── fr32.rs                  # FR32 padding
│   │   ├── tree.rs                  # Zero commitments, subtree stack
│   │   ├── multihash.rs             # Digest encoding
│   │   └── sha256/                  # Multi-message SHA-256 backends
│   └── tests/                       # go-fil-commp-hashhash known-answer tests
├── compare/                         # Rust/WASM vs go-fil-commp-hashhash comparison
└── .github/
    ├── release-please-config.json
    └── release-please-manifest.json
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 24
- [pnpm](https://pnpm.io/) >= 11
- To rebuild the WASM: [Rust](https://rustup.rs/) (stable), [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) and [binaryen](https://github.com/WebAssembly/binaryen) (`wasm-opt`)

```bash
# Install Node.js dependencies
pnpm install

# Only needed to rebuild the WASM
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install wasm-pack
```

## Building

The inline WASM in `packages/commp-wasm/src/inline` is committed, so the packages work straight from source. After changing the Rust crate, rebuild it and commit the result (CI fails if it is stale):

```bash
pnpm build:wasm
```

This runs `wasm-pack` on `rs/commp` and then embeds the binary as a base64 string for synchronous loading (no async init, works everywhere):

```text
WASM binary size: 21889 bytes
Base64 size: 29188 chars
Created: packages/commp-wasm/src/inline/commp_bg.wasm.js
Created: packages/commp-wasm/src/inline/commp_bg.js
Created: packages/commp-wasm/src/inline/commp.js
```

## Usage

Works in Node.js, browsers, Deno, and Bun with no async init required:

```javascript
import { create, root, digest } from "@hugomrdias/commp-wasm";

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
| `height` | `number` | Tree height (log₂ of piece size ÷ 32) |
| `padding` | `number` | Zero-padding bytes added |

### `create(): Hasher`

Creates a streaming hasher for processing data in chunks.

#### Hasher methods

- `write(data: Uint8Array): this` - Write data chunk. Throws a `RangeError`, leaving the hasher unchanged, if the total would exceed `MAX_PAYLOAD_SIZE`
- `digest(): PieceDigest` - Get full digest result
- `count(): bigint` - Get bytes written
- `reset(): this` - Reset hasher state
- `free(): void` - Free WASM memory (call when done)

### `MAX_PAYLOAD_SIZE: bigint`

Largest payload accepted: `127n * 2n ** 47n` bytes (~15.9 PiB). It is the largest size for which every digest field stays exact as a JS number. data-segment allows up to tree height 255, which no real payload approaches.

## Testing

```bash
# Run tests, lint and root checks for every package
pnpm check

# Run all tests
pnpm test

# Run benchmarks
pnpm bench

# Run benchmarks in a browser (chromium, firefox or webkit)
pnpm bench:browser --browser firefox

# Run Rust tests (from rs/commp)
cargo test --lib --tests
```

The Rust tests include the Lotus-generated vectors from go-fil-commp-hashhash, up to 16 MiB by default. See [rs/commp/tests/fixtures](rs/commp/tests/fixtures/README.md) to run larger ones.

## Releasing

Releases are managed by [release-please](https://github.com/googleapis/release-please) from [Conventional Commits](https://www.conventionalcommits.org/). Each package is versioned independently:

1. Merge commits into `master` using conventional commit messages (`feat:`, `fix:`, `perf:`, ...).
2. release-please opens a release PR per changed package (e.g. `commp-wasm 0.2.0`) with the version bump and `CHANGELOG.md`.
3. Merging a release PR tags it (e.g. `commp-wasm-v0.2.0`), creates a GitHub release and publishes the package to npm with trusted publishing.

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
- [rust-hashes issue](https://github.com/RustCrypto/hashes/issues/327) - sha256 backends

## License

MIT
