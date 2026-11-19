//! Multi-message SHA-256 with the ARMv8 SHA2 instructions
//!
//! sha2 hashes one message at a time, so each round waits on the previous
//! one's `sha256h`/`sha256h2`. Every leaf and every node on a tree level is
//! independent, so here `LANES` messages are hashed in step to keep the SHA
//! unit busy, and the constant padding block skips its message schedule.

use super::{IV, K, NODE_SIZE, PAD_KW};
use core::arch::aarch64::*;

/// Messages hashed in step
const LANES: usize = 4;

/// 64 rounds on each lane's `(abcd, efgh)` state, taking `K[i] + W[i]`
/// four at a time from `kw(group, lane)`, after which `update(group,
/// lane)` may extend that lane's message schedule
macro_rules! rounds {
    ($abcd:ident, $efgh:ident, $n:expr, |$g:ident, $l:ident| $kw:expr, $update:expr) => {
        unroll16!(|$g| {
            for $l in 0..$n {
                let kw = $kw;
                let abcd = $abcd[$l];
                $abcd[$l] = vsha256hq_u32(abcd, $efgh[$l], kw);
                $efgh[$l] = vsha256h2q_u32($efgh[$l], abcd, kw);
                $update;
            }
        });
    };
}

/// Hash `N` independent 64-byte messages into truncated nodes
#[inline(always)]
unsafe fn hash_lanes<const N: usize>(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    let iv = [vld1q_u32(IV.as_ptr()), vld1q_u32(IV.as_ptr().add(4))];
    // w[lane][j] holds schedule words 4j..4j+4, overwritten in place by
    // the words 16 later
    let mut w: [[uint32x4_t; 4]; N] = core::array::from_fn(|l| {
        core::array::from_fn(|j| {
            vreinterpretq_u32_u8(vrev32q_u8(vld1q_u8(msgs[l].as_ptr().add(16 * j))))
        })
    });
    let mut abcd = [iv[0]; N];
    let mut efgh = [iv[1]; N];
    rounds!(
        abcd,
        efgh,
        N,
        |g, l| vaddq_u32(w[l][g % 4], vld1q_u32(K.as_ptr().add(4 * g))),
        {
            if g < 12 {
                let next = vsha256su0q_u32(w[l][g % 4], w[l][(g + 1) % 4]);
                w[l][g % 4] = vsha256su1q_u32(next, w[l][(g + 2) % 4], w[l][(g + 3) % 4]);
            }
        }
    );

    // Second block: the padding, whose K + W is precomputed
    let mut mid = [[iv[0]; 2]; N];
    for l in 0..N {
        abcd[l] = vaddq_u32(abcd[l], iv[0]);
        efgh[l] = vaddq_u32(efgh[l], iv[1]);
        mid[l] = [abcd[l], efgh[l]];
    }
    rounds!(
        abcd,
        efgh,
        N,
        |g, l| vld1q_u32(PAD_KW.as_ptr().add(4 * g)),
        {}
    );

    for l in 0..N {
        let node = out[l].as_mut_ptr();
        vst1q_u8(
            node,
            vrev32q_u8(vreinterpretq_u8_u32(vaddq_u32(abcd[l], mid[l][0]))),
        );
        vst1q_u8(
            node.add(16),
            vrev32q_u8(vreinterpretq_u8_u32(vaddq_u32(efgh[l], mid[l][1]))),
        );
        out[l][NODE_SIZE - 1] &= 0b0011_1111;
    }
}

/// Hash many 64-byte messages into truncated nodes, `LANES` at a time
#[target_feature(enable = "sha2")]
pub unsafe fn hash_many(msgs: &[[u8; 64]], out: &mut [[u8; NODE_SIZE]]) {
    let out = &mut out[..msgs.len()];
    let (msg_groups, msg_rest) = msgs.as_chunks::<LANES>();
    let (out_groups, out_rest) = out.as_chunks_mut::<LANES>();
    for (m, o) in msg_groups.iter().zip(out_groups) {
        hash_lanes::<LANES>(m, o);
    }
    for (m, o) in msg_rest.iter().zip(out_rest) {
        hash_lanes::<1>(core::slice::from_ref(m), core::slice::from_mut(o));
    }
}
