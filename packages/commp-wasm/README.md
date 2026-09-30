# @commp/wasm

Fast CommP (Filecoin Piece Commitment) in Rust/WASM with 4-lane SIMD SHA-256. The WASM is inlined as base64, so there is no async init and no bundler configuration.

## Install

```bash
npm install @commp/wasm
```

## Usage

```javascript
import { create, digest, root } from '@commp/wasm'

// One-shot: just the 32-byte root
const rootHash = root(data)

// One-shot: full multihash digest with metadata
const result = digest(data)

// Streaming: for large files
const hasher = create()
for (const chunk of chunks) {
  hasher.write(chunk)
}
const streamResult = hasher.digest()
hasher.free() // Free WASM memory when done
```

See the [repository README](https://github.com/hugomrdias/commp#readme) for the full API and benchmarks.

## License

MIT
