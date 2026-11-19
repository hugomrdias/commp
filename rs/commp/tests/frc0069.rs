//! FRC-0069 test vectors
//!
//! <https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md>

use commp::CommPHasher;

/// Payload size, fill byte, PieceCIDv2 and its multihash (hex)
const VECTORS: [(usize, u8, &str, &str); 6] = [
    (
        0,
        0x00,
        "bafkzcibcp4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy",
        "9120227f023731bb99ac689f66eef5973e4a94da188f4ddcae580724fc6f3fd60dfd488333",
    ),
    (
        1,
        0x01,
        "bafkzcibcpyba3vw24qoc65kvaeuvst5witskqqwpv6zrniwvsmq6hch6qsq6yly",
        "9120227e020dd6dae41c2f75550129594fb644e4a842cfafb316a2d59321e388fe84a1ec2f",
    ),
    (
        64,
        0x01,
        "bafkzcibch4beda6pru25m2g5kbvsnsj3za7le45vcauwicz2wsmjs43q3dajkpy",
        "9120223f024183cf8d35d668dd506b26c93bc83eb273b51029640b3ab498997370d8c0953f",
    ),
    (
        65,
        0x01,
        "bafkzcibchybkmpf2ifpzvzxjq4hxunlb6hsgyy4tladusdjlvykymhwpdifkkny",
        "9120223e02a63cba415f9ae6e9870f7a3561f1e46c63935807490d2bae15861ecf1a0aa537",
    ),
    (
        127,
        0x00,
        "bafkzcibcaabdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy",
        "91202200023731bb99ac689f66eef5973e4a94da188f4ddcae580724fc6f3fd60dfd488333",
    ),
    (
        128,
        0x00,
        "bafkzcibcpybwiktap34inmaex4wbs6cghlq5i2j2yd2bb2zndn5ep7ralzphkdy",
        "9120227e03642a607ef886b004bf2c1978463ae1d4693ac0f410eb2d1b7a47fe205e5e750f",
    ),
];

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn frc0069_vectors() {
    for (size, fill, cid, multihash) in VECTORS {
        let mut hasher = CommPHasher::new();
        hasher.write(&vec![fill; size]).unwrap();
        assert_eq!(hex(&hasher.digest()), multihash, "{size} bytes -> {cid}");
        assert_eq!(
            hex(&commp::digest(&vec![fill; size]).unwrap()),
            multihash,
            "one-shot {size} bytes -> {cid}"
        );
    }
}

#[test]
fn short_payloads_are_zero_padded() {
    let full: Vec<u8> = (1..=127).collect();
    for size in 0..127 {
        let mut padded = [0u8; 127];
        padded[..size].copy_from_slice(&full[..size]);
        let mut short = CommPHasher::new();
        short.write(&full[..size]).unwrap();
        let mut long = CommPHasher::new();
        long.write(&padded).unwrap();
        assert_eq!(short.root(), long.root(), "{size} bytes");
        assert_eq!(short.height(), 2, "{size} bytes");
    }
}
