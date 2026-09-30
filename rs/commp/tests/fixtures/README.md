# Fixtures

`random.txt`, `zero.txt` and `0xCC.txt` are copied unchanged from
[go-fil-commp-hashhash](https://github.com/filecoin-project/go-fil-commp-hashhash/tree/2563685167835b98a40bfade4fbdbdc0f9db376b/testdata),
where Lotus computed each `payloadSize,pieceSize,pieceCID` line. `random.txt`
payloads are Go `math/rand` bytes seeded with 1337 (see `../common/go_rand.rs`).

`cargo test --lib --tests` checks cases up to 16 MiB. For more, raise the limit
(`random.txt` goes up to 32 GiB):

    COMMP_VECTORS_MAX_SIZE=1073741824 cargo test --release --test go_vectors
