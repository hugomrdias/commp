/**
 * Optimized merkle tree building for CommP
 *
 * Uses pre-allocated buffers and index-based management to minimize
 * allocations during tree construction.
 *
 * @module
 */

import { NODE_SIZE } from './constants.js'
import { CONCAT_BUFFER, truncatedHash } from './hash.js'
import { fromLevel as zeroFromLevel } from './zero-comm.js'

/**
 * Computes a parent node from two child nodes using truncated SHA256
 *
 * @example
 * ```ts twoslash
 * import { computeNode } from './tree.js'
 *
 * const left = new Uint8Array(32).fill(1)
 * const right = new Uint8Array(32).fill(2)
 * const parent = computeNode(left, right)
 * ```
 *
 * @param {Uint8Array} left - Left child node (32 bytes)
 * @param {Uint8Array} right - Right child node (32 bytes)
 * @returns {Uint8Array} - Parent node (32 bytes, new allocation)
 */
export function computeNode(left, right) {
	CONCAT_BUFFER.set(left, 0)
	CONCAT_BUFFER.set(right, NODE_SIZE)
	return truncatedHash(CONCAT_BUFFER)
}

/**
 * Computes a parent node in-place into an output buffer
 *
 * @param {Uint8Array} left - Left child node (32 bytes)
 * @param {Uint8Array} right - Right child node (32 bytes)
 * @param {Uint8Array} output - Output buffer for parent node (32 bytes)
 * @param {number} [outputOffset=0] - Offset into output buffer
 */
export function computeNodeInto(left, right, output, outputOffset = 0) {
	CONCAT_BUFFER.set(left, 0)
	CONCAT_BUFFER.set(right, NODE_SIZE)
	const hash = truncatedHash(CONCAT_BUFFER)
	output.set(hash, outputOffset)
}

/**
 * @typedef {Object} TreeLayer
 * @property {Uint8Array[]} nodes - Array of 32-byte node buffers
 * @property {number} count - Number of active nodes in this layer
 */

/**
 * Creates a new tree layer with pre-allocated capacity
 *
 * @param {number} [capacity=1024] - Initial capacity for nodes
 * @returns {TreeLayer}
 */
export function createLayer(capacity = 1024) {
	return {
		nodes: new Array(capacity),
		count: 0,
	}
}

/**
 * Prunes layers by combining node pairs into parent nodes.
 * After pruning, each layer will have at most one node.
 *
 * @param {TreeLayer[]} layers - Array of tree layers (layer 0 = leaves)
 */
export function prune(layers) {
	flush(layers, false)
}

/**
 * Builds the final tree by combining all nodes up to the root.
 * Odd nodes are paired with zero padding nodes at their level.
 *
 * @param {TreeLayer[]} layers - Array of tree layers
 * @returns {TreeLayer[]} - The built layers (may have new layers added)
 */
export function build(layers) {
	// Clone layers for build to not mutate the streaming state
	const cloned = layers.map((layer) => ({
		nodes: [...layer.nodes],
		count: layer.count,
	}))
	flush(cloned, true)
	return cloned
}

/**
 * Internal flush operation that combines nodes up the tree
 *
 * Follows the same algorithm as @web3-storage/data-segment:
 * - During prune (isBuild=false): combine pairs, leave odd nodes for later
 * - During build (isBuild=true): pad odd nodes with zeros, combine all
 *
 * @param {TreeLayer[]} layers - Tree layers to flush
 * @param {boolean} isBuild - If true, pad odd nodes with zeros; if false, leave for later
 */
function flush(layers, isBuild) {
	let level = 0

	while (level < layers.length) {
		const layer = layers[level]
		let next = level + 1 < layers.length ? layers[level + 1] : null

		// If building and we have odd number of nodes AND there's a next layer,
		// add zero padding for this level.
		// NOTE: We use level+1 because our "leaves" are already hashes of 64-byte pairs,
		// which is equivalent to level 1 in the original raw-chunk tree.
		if (isBuild && layer.count % 2 === 1 && next) {
			layer.nodes[layer.count] = zeroFromLevel(level + 1)
			layer.count++
		}

		level++

		// Prepare the next layer
		// If building, we need to clone to not mutate; if pruning, use as-is
		if (next) {
			if (isBuild) {
				// Clone the next layer's nodes for build mode
				const clonedNodes = []
				for (let i = 0; i < next.count; i++) {
					clonedNodes[i] = next.nodes[i]
				}
				next = { nodes: clonedNodes, count: next.count }
				layers[level] = next
			}
		} else {
			next = createLayer()
		}

		// Combine pairs of nodes
		let index = 0
		while (index + 1 < layer.count) {
			const left = layer.nodes[index]
			const right = layer.nodes[index + 1]
			const parent = computeNode(left, right)

			next.nodes[next.count] = parent
			next.count++

			// Clear processed nodes for GC
			layer.nodes[index] = /** @type {any} */ (undefined)
			layer.nodes[index + 1] = /** @type {any} */ (undefined)

			index += 2
		}

		// Only add next layer if it has nodes
		if (next.count > 0) {
			layers[level] = next
		}

		// Remove processed nodes from current layer, keeping any unpaired node
		if (index < layer.count) {
			// Move unpaired node to front
			layer.nodes[0] = layer.nodes[index]
			for (let i = 1; i <= index; i++) {
				layer.nodes[i] = /** @type {any} */ (undefined)
			}
			layer.count = 1
		} else {
			layer.count = 0
		}
	}
}

/**
 * Gets the root node from built layers
 *
 * @param {TreeLayer[]} layers - Built tree layers
 * @returns {Uint8Array} - The 32-byte root node
 */
export function getRoot(layers) {
	const topLayer = layers[layers.length - 1]
	return topLayer.nodes[0]
}

/**
 * Gets the tree height from layers
 *
 * @param {TreeLayer[]} layers - Tree layers
 * @returns {number} - Height of the tree
 */
export function getHeight(layers) {
	return layers.length - 1
}
