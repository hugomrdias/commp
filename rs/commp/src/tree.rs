//! Merkle tree: zero commitments, level reduction and the pending-subtree
//! stack

use crate::sha256::{hash_many, truncated_hash_64};
use crate::{BATCH_LEAVES, MAX_LEVEL, NODE_SIZE};

/// Pre-computed zero commitment nodes for each level (lazily initialized)
pub fn get_zero_comm(level: usize) -> [u8; NODE_SIZE] {
    #[cfg(not(target_arch = "wasm32"))]
    static ZERO_COMMS: std::sync::OnceLock<[[u8; NODE_SIZE]; MAX_LEVEL]> = std::sync::OnceLock::new();
    #[cfg(target_arch = "wasm32")]
    static ZERO_COMMS: SingleThreaded<core::cell::OnceCell<[[u8; NODE_SIZE]; MAX_LEVEL]>> =
        SingleThreaded(core::cell::OnceCell::new());

    ZERO_COMMS.get_or_init(|| {
        let mut comms = [[0u8; NODE_SIZE]; MAX_LEVEL];
        let mut concat = [0u8; NODE_SIZE * 2];
        
        for i in 1..MAX_LEVEL {
            concat[..NODE_SIZE].copy_from_slice(&comms[i - 1]);
            concat[NODE_SIZE..].copy_from_slice(&comms[i - 1]);
            comms[i] = truncated_hash_64(&concat);
        }
        comms
    })[level]
}

/// Lets a `static` hold a non-`Sync` value on wasm32
#[cfg(target_arch = "wasm32")]
struct SingleThreaded<T>(T);

// SAFETY: without the `atomics` target feature wasm32 has no threads
#[cfg(all(target_arch = "wasm32", not(target_feature = "atomics")))]
unsafe impl<T> Sync for SingleThreaded<T> {}

#[cfg(target_arch = "wasm32")]
impl<T> core::ops::Deref for SingleThreaded<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.0
    }
}

/// View a level of nodes as the 64-byte messages formed by adjacent pairs
#[inline(always)]
fn as_pairs(nodes: &[[u8; NODE_SIZE]]) -> &[[u8; 64]] {
    debug_assert!(nodes.len() % 2 == 0);
    // SAFETY: [[u8; 32]; 2] and [u8; 64] have the same size and alignment (1)
    unsafe { core::slice::from_raw_parts(nodes.as_ptr() as *const [u8; 64], nodes.len() / 2) }
}

/// Reduce `len` nodes at tree `height` by `steps` levels, pairing an odd
/// trailing node with a zero commitment. The result is left at the start of
/// `nodes`; returns the remaining count.
#[inline(never)]
pub fn reduce(nodes: &mut [[u8; NODE_SIZE]], mut len: usize, mut height: usize, steps: usize) -> usize {
    let mut next = [[0u8; NODE_SIZE]; BATCH_LEAVES / 2];
    for _ in 0..steps {
        if len % 2 == 1 {
            nodes[len] = get_zero_comm(height);
            len += 1;
        }
        len /= 2;
        hash_many(as_pairs(&nodes[..len * 2]), &mut next[..len]);
        nodes[..len].copy_from_slice(&next[..len]);
        height += 1;
    }
    len
}

/// Compute parent node from two children using a pre-allocated buffer
#[inline(always)]
pub fn compute_node_into(left: &[u8; NODE_SIZE], right: &[u8; NODE_SIZE], concat: &mut [u8; 64]) -> [u8; NODE_SIZE] {
    concat[..NODE_SIZE].copy_from_slice(left);
    concat[NODE_SIZE..].copy_from_slice(right);
    truncated_hash_64(concat)
}

/// Pending subtree roots, one per tree level, updated like a binary counter
///
/// Bit `k` of `count` is set when `nodes[k]` holds the root of a complete
/// subtree of `2^k` leaves that is still waiting for its right sibling. Memory
/// is O(log n) regardless of input size.
#[derive(Clone, Copy)]
pub struct Stack {
    /// `nodes[k]` is a pending node at tree level `k + 1`
    nodes: [[u8; NODE_SIZE]; MAX_LEVEL],
    /// Number of leaves pushed so far
    pub count: u64,
}

impl Stack {
    pub fn new() -> Self {
        Stack {
            // A memset: the `[[0; 32]; 64]` literal is unrolled into 128 SIMD
            // stores at every call site, ~3KB each
            // SAFETY: all-zero bytes are a valid [[u8; 32]; 64]
            nodes: unsafe { core::mem::zeroed() },
            count: 0,
        }
    }

    /// Push the root of a complete subtree of `2^level` leaves, merging
    /// completed subtrees upward. `count` must be a multiple of `2^level`.
    #[inline]
    pub fn push_at(&mut self, root: [u8; NODE_SIZE], mut level: usize, concat: &mut [u8; 64]) {
        debug_assert!(self.count % (1 << level) == 0);
        self.count += 1 << level;
        let mut node = root;
        while self.count >> level & 1 == 0 {
            node = compute_node_into(&self.nodes[level], &node, concat);
            level += 1;
        }
        self.nodes[level] = node;
    }

    /// Fold pending nodes into the root, padding with zero commitments
    ///
    /// Our leaves hash 64-byte halves of a quad, so they are level 1 of the
    /// reference tree (level 0 is the raw 32-byte FR32 chunks). Requires at
    /// least two leaves. Returns (height, root).
    pub fn fold(&self) -> (u8, [u8; NODE_SIZE]) {
        let n = self.count;
        let top = (u64::BITS - 1 - n.leading_zeros()) as usize;
        if n.is_power_of_two() {
            return ((top + 1) as u8, self.nodes[top]);
        }

        // Carry the right-most partial subtree up to the level of `top`,
        // pairing it with a pending left sibling or a zero commitment
        let mut concat = [0u8; 64];
        let lowest = n.trailing_zeros() as usize;
        let mut acc = compute_node_into(&self.nodes[lowest], &get_zero_comm(lowest + 1), &mut concat);
        for level in lowest + 1..top {
            acc = if n >> level & 1 == 1 {
                compute_node_into(&self.nodes[level], &acc, &mut concat)
            } else {
                compute_node_into(&acc, &get_zero_comm(level + 1), &mut concat)
            };
        }

        ((top + 2) as u8, compute_node_into(&self.nodes[top], &acc, &mut concat))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use alloc::vec::Vec;

    /// Naive level-by-level tree over level-1 leaves, padding odd levels
    pub fn naive_tree(leaves: &[[u8; NODE_SIZE]]) -> (u8, [u8; NODE_SIZE]) {
        let mut concat = [0u8; 64];
        let mut current = leaves.to_vec();
        let mut height = 1u8;
        while current.len() > 1 {
            if current.len() % 2 == 1 {
                current.push(get_zero_comm(height as usize));
            }
            current = current
                .chunks(2)
                .map(|pair| compute_node_into(&pair[0], &pair[1], &mut concat))
                .collect();
            height += 1;
        }
        (height, current[0])
    }

    #[test]
    fn test_stack_matches_naive_tree() {
        let mut concat = [0u8; 64];
        let leaves: Vec<[u8; NODE_SIZE]> = (0..600u32)
            .map(|i| {
                let mut block = [0u8; 64];
                block[..4].copy_from_slice(&i.to_le_bytes());
                truncated_hash_64(&block)
            })
            .collect();

        let mut stack = Stack::new();
        for n in 1..=leaves.len() {
            stack.push_at(leaves[n - 1], 0, &mut concat);
            let (height, root) = stack.fold();
            if n == 1 {
                // A single leaf is its own root; never happens in practice
                assert_eq!((height, root), (1, leaves[0]));
                continue;
            }
            assert_eq!((height, root), naive_tree(&leaves[..n]), "{n} leaves");
        }
    }
}
