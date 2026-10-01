// Type tests: resolves the package through its `exports`, like a consumer
import type { PieceDigest, StreamingHasher } from '@hugomrdias/commp-wasm'
import {
  code,
  create,
  digest,
  MAX_PAYLOAD_SIZE,
  name,
  root,
} from '@hugomrdias/commp-wasm'

const payload = new Uint8Array(1024)

const hasher: StreamingHasher = create().write(payload)
const result: PieceDigest = digest(payload)
const rootOnly: Uint8Array = root(payload)
const multihash: { code: 0x1011; name: typeof name } = { code, name }
const limit: bigint = MAX_PAYLOAD_SIZE

// @ts-expect-error internal state is private
create().inner

export { hasher, limit, multihash, result, rootOnly }
