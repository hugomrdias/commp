// Type tests: resolves the package through its `exports`, like a consumer
import type {
  HasherOptions,
  MerkleTreeNode,
  PieceDigest,
  StreamingHasher,
} from '@hugomrdias/commp-js'
import {
  code,
  create,
  digest,
  MAX_PAYLOAD_SIZE,
  MAX_SIZE,
  name,
} from '@hugomrdias/commp-js'

const payload = new Uint8Array(1024)

const hasher: StreamingHasher = create().write(payload)
const result: PieceDigest = digest(payload)
const root: MerkleTreeNode = result.root
const options: HasherOptions = { capacityHint: 1 }
const multihash: { code: 0x1011; name: typeof name } = { code, name }
const limits: [bigint, number] = [MAX_PAYLOAD_SIZE, MAX_SIZE]

// @ts-expect-error internal state is private
create().stack

export { hasher, limits, multihash, options, root }
