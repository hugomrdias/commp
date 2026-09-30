//! Known-answer tests ported from go-fil-commp-hashhash
//!
//! `fixtures/*.txt` are copied from that repo. Each line is
//! `payloadSize,pieceSize,pieceCID`, with the CID computed by Lotus
//! (`Filecoin.ClientCalcCommP`), so these check our output against an
//! independent implementation rather than against our own primitives.
//!
//! Cases above `COMMP_VECTORS_MAX_SIZE` bytes (default 16 MiB) are skipped;
//! `random.txt` goes up to 32 GiB.

mod common;

use common::go_rand::GoRand;
use commp::CommPHasher;

const DEFAULT_MAX_SIZE: u64 = 16 << 20;
const NODE_SIZE: usize = 32;

struct Vector {
    payload_size: u64,
    piece_size: u64,
    root: [u8; NODE_SIZE],
}

fn max_size() -> u64 {
    match std::env::var("COMMP_VECTORS_MAX_SIZE") {
        Ok(v) => v
            .parse()
            .expect("COMMP_VECTORS_MAX_SIZE must be a byte count"),
        Err(_) => DEFAULT_MAX_SIZE,
    }
}

fn parse_vectors(csv: &str) -> Vec<Vector> {
    csv.lines()
        .map(|line| {
            let parts: Vec<&str> = line.split(',').collect();
            // Drop the multibase 'b'; the root is the CID's last 32 bytes
            let cid = base32_decode(parts[2].strip_prefix('b').expect("base32 CID"));
            Vector {
                payload_size: parts[0].parse().unwrap(),
                piece_size: parts[1].parse().unwrap(),
                root: cid[cid.len() - NODE_SIZE..].try_into().unwrap(),
            }
        })
        .collect()
}

/// Unpadded lowercase RFC 4648 base32
fn base32_decode(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len() * 5 / 8);
    let (mut acc, mut bits) = (0u32, 0);
    for c in s.bytes() {
        let v = match c {
            b'a'..=b'z' => c - b'a',
            b'2'..=b'7' => c - b'2' + 26,
            _ => panic!("invalid base32 character {:?}", c as char),
        };
        acc = (acc << 5) | v as u32;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

/// Hash `size` bytes from `fill`, written as 127, 254, then odd-sized
/// chunks so quads straddle writes (like Go's `verifyReaderSizeAndCommP`)
fn hash_stream(size: u64, mut fill: impl FnMut(&mut [u8])) -> CommPHasher {
    let mut hasher = CommPHasher::new();
    let mut buf = vec![0u8; (1 << 20) + 1];
    let mut remaining = size;
    for write in [127, 254]
        .into_iter()
        .chain(std::iter::repeat(buf.len() as u64))
    {
        if remaining == 0 {
            break;
        }
        let chunk = &mut buf[..write.min(remaining) as usize];
        fill(chunk);
        hasher.write(chunk).unwrap();
        remaining -= chunk.len() as u64;
    }
    hasher
}

fn check_vectors(csv: &str, mut fill_for: impl FnMut() -> Box<dyn FnMut(&mut [u8])>) {
    let max = max_size();
    let vectors = parse_vectors(csv);
    let mut checked = 0;
    for v in vectors.iter().filter(|v| v.payload_size <= max) {
        let hasher = hash_stream(v.payload_size, fill_for());
        assert_eq!(hasher.count(), v.payload_size);
        assert_eq!(
            32u64 << hasher.height(),
            v.piece_size,
            "piece size for {} bytes",
            v.payload_size
        );
        assert_eq!(hasher.root(), v.root, "root for {} bytes", v.payload_size);
        checked += 1;
    }
    assert!(checked > 0, "no vectors at or below {max} bytes");
}

/// jbenet/go-random: seed-1337 `Uint32`s, little-endian, 4 bytes each
fn go_random() -> Box<dyn FnMut(&mut [u8])> {
    let mut rng = GoRand::new(1337);
    let (mut word, mut left) = (0u32, 0);
    Box::new(move |buf| {
        for b in buf {
            if left == 0 {
                word = rng.uint32();
                left = 4;
            }
            *b = word as u8;
            word >>= 8;
            left -= 1;
        }
    })
}

fn repeated(byte: u8) -> impl FnMut() -> Box<dyn FnMut(&mut [u8])> {
    move || Box::new(move |buf| buf.fill(byte))
}

#[test]
fn test_go_rand_matches_go() {
    // rand.New(rand.NewSource(1337)).Uint32() from Go 1.27: the first four
    // values, then the 100,000th (well past the 607-entry register)
    let mut rng = GoRand::new(1337);
    let first: Vec<u32> = (0..4).map(|_| rng.uint32()).collect();
    assert_eq!(first, [2700411476, 1469801357, 1792880398, 4124580502]);
    let last = (4..100_000).map(|_| rng.uint32()).last();
    assert_eq!(last, Some(1281583870));
}

#[test]
fn test_vectors_random() {
    check_vectors(include_str!("fixtures/random.txt"), go_random);
}

#[test]
fn test_vectors_zero() {
    check_vectors(include_str!("fixtures/zero.txt"), repeated(0x00));
}

#[test]
fn test_vectors_0xcc() {
    check_vectors(include_str!("fixtures/0xCC.txt"), repeated(0xCC));
}
