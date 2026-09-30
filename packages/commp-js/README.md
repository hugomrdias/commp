# @hugomrdias/commp-js

Fast CommP (Filecoin Piece Commitment) in pure JavaScript, using [`@webbuf/sha256`](https://www.npmjs.com/package/@webbuf/sha256) and streaming with O(log n) memory.

For the fastest implementation use [`@hugomrdias/commp-wasm`](../commp-wasm).

## Install

```bash
npm install @hugomrdias/commp-js
```

## Usage

```javascript
import { create } from '@hugomrdias/commp-js'

const hasher = create()
hasher.write(chunk1)
hasher.write(chunk2)
const result = hasher.digest()
console.log(result.root) // 32-byte root hash
console.log(result.height) // tree height
console.log(result.padding) // zero-padding added
```

See the [repository README](https://github.com/hugomrdias/commp#readme) for the full API and benchmarks.

## License

MIT
