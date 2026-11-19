# apple-m1-pro-darwin-arm64

2026-11-19T12:11:00.646Z

|  |  |
| --- | --- |
| CPU | Apple M1 Pro (8P + 2E) |
| Cores | 10 physical, 10 logical |
| OS | Darwin 27.2.0 (darwin/arm64) |
| SHA-related CPU features | sha2 sha512 asimd ~~sve~~ ~~sve2~~ |
| Virtualized | no |
| Source | 7069a6df8a + uncommitted changes (17a7cb5af735) |
| Versions | commp 0.1.0, cpufeatures 0.3.1, sha2 0.11.0, filecoin-project/go-fil-commp-hashhash v0.4.0, minio/sha256-simd v1.0.1 / => ./sha256stdlib, @hugomrdias/commp-wasm 0.1.4, inline wasm sha256 74ea3845a573644e |
| Toolchains | go version go1.27.4 darwin/arm64, rustc 1.92.0 (ded5c06cf 2025-12-08), node v24.21.0 |

## Correctness

- Lotus vectors up to 64 MiB: 938 checks, 0 failures (45 larger vectors skipped)
- Sweep up to 4 MiB: 300 payloads, 0 disagreements
- Variants: rust, rust-par, rust-soft, go, go-stdlib, go-nosha, wasm

## Speed

MiB/s, median of the runs; CPU cores = (user + sys) / wall at 1 GiB.

| Variant | SHA-256 backend | 32 MiB MiB/s | 1 GiB MiB/s | CPU cores |
| --- | --- | --- | --- | --- |
| `rust` | ARMv8 SHA2, 4 messages interleaved | 726.2 | 711.2 | 1.00 |
| `rust-par` | ARMv8 SHA2, 4 messages interleaved, 10 threads | 3791.4 | 3778.9 | 8.59 |
| `rust-soft` | NEON, 8 messages per SHA-256 (2 vectors), forced | 303.3 | 299.6 | 1.00 |
| `go` | sha256-simd/ARMv8 | 715.0 | 718.5 | 2.60 |
| `go-1core` | sha256-simd/ARMv8 | 340.3 | 339.3 | 1.00 |
| `go-stdlib` | crypto/sha256/ARMv8 | 874.8 | 823.4 | 2.66 |
| `go-nosha` | crypto/sha256/generic | 136.4 | 136.4 | 2.17 |
| `go-nosha-1core` | crypto/sha256/generic | 70.3 | 69.6 | 1.00 |
| `wasm` | wasm simd128, 4 messages per SHA-256 | 170.9 | 169.7 | 1.00 |

## Memory

Peak RSS of the whole process (Node alone is ~40 MiB); growth is peak RSS after hashing minus before. Heap is what the hasher allocated during the run (not tracked for WASM).

| Variant | Payload | Peak RSS | RSS growth | Heap allocated | Allocations |
| --- | --- | --- | --- | --- | --- |
| `rust` | 1 MiB | 1.9 MiB | 16 KiB | 16 KiB | 2 |
| `rust-par` | 1 MiB | 2.5 MiB | 0 B | 16 KiB | 2 |
| `go` | 1 MiB | 8 MiB | 976 KiB | 1.1 MiB | 219 |
| `go-1core` | 1 MiB | 6.5 MiB | 384 KiB | 1.1 MiB | 207 |
| `wasm` | 1 MiB | 57 MiB | 368 KiB | n/a | n/a |
| `rust` | 1 GiB | 1.9 MiB | 16 KiB | 16 KiB | 2 |
| `rust-par` | 1 GiB | 2.8 MiB | 176 KiB | 30.9 KiB | 12 |
| `go` | 1 GiB | 11.5 MiB | 736 KiB | 1032.2 MiB | 33443 |
| `go-1core` | 1 GiB | 26.8 MiB | 14.3 MiB | 1032.1 MiB | 33219 |
| `wasm` | 1 GiB | 59 MiB | 2.3 MiB | n/a | n/a |
