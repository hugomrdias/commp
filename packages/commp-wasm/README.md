# @hugomrdias/commp-wasm

Fast CommP (Filecoin Piece Commitment) in Rust/WASM with 4-lane SIMD SHA-256. The WASM is inlined as base64, so there is no async init and no bundler configuration. It is compiled on first use, so importing never compiles WebAssembly.

## Install

```bash
npm install @hugomrdias/commp-wasm
```

## Usage

```javascript
import { create, digest, root } from '@hugomrdias/commp-wasm'

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

## Content-Security-Policy

The WASM module is compiled on first use, not at import. In browsers, a page whose Content-Security-Policy sets `script-src` must allow `'wasm-unsafe-eval'` for hashing to work:

```
Content-Security-Policy: script-src 'self' 'wasm-unsafe-eval'
```

Without it, importing still works, but the first hash throws an error that names the missing directive, with the browser's `CompileError` as its `cause`.

See the [repository README](https://github.com/hugomrdias/commp#readme) for the full API and benchmarks.

## License

MIT
