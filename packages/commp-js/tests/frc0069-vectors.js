/**
 * FRC-0069 test vectors, shared with @hugomrdias/commp-wasm
 *
 * @see https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md
 */

/**
 * Payload size, fill byte, PieceCIDv2 and its multihash (hex)
 *
 * @type {Array<[number, number, string, string]>}
 */
export const vectors = [
  [
    0,
    0x00,
    'bafkzcibcp4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
    '9120227f023731bb99ac689f66eef5973e4a94da188f4ddcae580724fc6f3fd60dfd488333',
  ],
  [
    1,
    0x01,
    'bafkzcibcpyba3vw24qoc65kvaeuvst5witskqqwpv6zrniwvsmq6hch6qsq6yly',
    '9120227e020dd6dae41c2f75550129594fb644e4a842cfafb316a2d59321e388fe84a1ec2f',
  ],
  [
    64,
    0x01,
    'bafkzcibch4beda6pru25m2g5kbvsnsj3za7le45vcauwicz2wsmjs43q3dajkpy',
    '9120223f024183cf8d35d668dd506b26c93bc83eb273b51029640b3ab498997370d8c0953f',
  ],
  [
    65,
    0x01,
    'bafkzcibchybkmpf2ifpzvzxjq4hxunlb6hsgyy4tladusdjlvykymhwpdifkkny',
    '9120223e02a63cba415f9ae6e9870f7a3561f1e46c63935807490d2bae15861ecf1a0aa537',
  ],
  [
    127,
    0x00,
    'bafkzcibcaabdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
    '91202200023731bb99ac689f66eef5973e4a94da188f4ddcae580724fc6f3fd60dfd488333',
  ],
  [
    128,
    0x00,
    'bafkzcibcpybwiktap34inmaex4wbs6cghlq5i2j2yd2bb2zndn5ep7ralzphkdy',
    '9120227e03642a607ef886b004bf2c1978463ae1d4693ac0f410eb2d1b7a47fe205e5e750f',
  ],
]
