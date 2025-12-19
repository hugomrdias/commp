/**
 * CommP (Filecoin Piece Commitment) constants
 * @see https://spec.filecoin.io/#section-systems.filecoin_files.piece.data-representation
 */

/** Number of bits per byte */
export const BITS_PER_BYTE = 8

/** The number of Frs (field elements) per Quad */
export const FRS_PER_QUAD = 4

/** The amount of bits in an Fr when not padded (254 bits) */
export const IN_BITS_FR = 254

/** The amount of bits in an Fr when padded (256 bits = 32 bytes) */
export const OUT_BITS_FR = 256

/** Input bytes per quad: 127 bytes (4 * 254 bits / 8) */
export const IN_BYTES_PER_QUAD = /** @type {127} */ (
	(FRS_PER_QUAD * IN_BITS_FR) / BITS_PER_BYTE
)

/** Output bytes per quad after FR32 padding: 128 bytes (4 * 256 bits / 8) */
export const OUT_BYTES_PER_QUAD = /** @type {128} */ (
	(FRS_PER_QUAD * OUT_BITS_FR) / BITS_PER_BYTE
)

/** Size of a merkle tree node in bytes (32 bytes) */
export const NODE_SIZE = /** @type {32} */ (OUT_BYTES_PER_QUAD / FRS_PER_QUAD)

/** Ratio of input to output bits for FR32 padding */
export const FR_RATIO = IN_BITS_FR / OUT_BITS_FR

/** Number of leaves produced per quad (2 leaves of 64 bytes each, hashed to 32 bytes) */
export const LEAVES_PER_QUAD = 2

/**
 * The smallest amount of data for which FR32 padding has a defined result.
 * Silently upgrading 2 leaves to 4 would break the symmetry so we require
 * an extra byte and the rest can be 0 padded to expand to 4 leaves.
 */
export const MIN_PAYLOAD_SIZE = 2 * NODE_SIZE + 1

/**
 * Multihash code for fr32-sha2-256-trunc254-padded-binary-tree
 * @see https://github.com/multiformats/multicodec/pull/331/files
 */
export const MULTIHASH_CODE = /** @type {0x1011} */ (0x1011)

/** Maximum tree height (fits in one byte) */
export const MAX_HEIGHT = 255

/** Size of the multihash code when varint encoded */
export const CODE_SIZE = 2

/** Size of the tree height field */
export const HEIGHT_SIZE = 1

/** Size of the root hash */
export const ROOT_SIZE = NODE_SIZE
