# apple-m1-pro-darwin-arm64

2026-09-30T11:45:34.887Z

|  |  |
| --- | --- |
| CPU | Apple M1 Pro (8P + 2E) |
| Cores | 10 physical, 10 logical |
| OS | Darwin 24.6.0 (darwin/arm64) |
| SHA-related CPU features | sha2 sha512 asimd ~~sve~~ ~~sve2~~ |
| Virtualized | no |
| Source | 2926c7b530 |
| Versions | commp 0.1.0, cpufeatures 0.3.1, sha2 0.11.0, filecoin-project/go-fil-commp-hashhash v0.4.0, minio/sha256-simd v1.0.1 / => ./sha256stdlib, @hugomrdias/commp-wasm 0.0.0, inline wasm sha256 658df404de2a463f |
| Toolchains | go version go1.27.1 darwin/arm64, rustc 1.92.0 (ded5c06cf 2025-12-08), node v26.10.0 |

## Correctness

- Lotus vectors up to 64 MiB: 1072 checks, 0 failures (45 larger vectors skipped)
- Sweep up to 4 MiB: 300 payloads, 0 disagreements
- Variants: rust, rust-par, rust-soft, rust-portable, go, go-stdlib, go-nosha, wasm

## Speed

MiB/s, median of the runs; CPU cores = (user + sys) / wall at 1 GiB.

| Variant | SHA-256 backend | 32 MiB MiB/s | 1 GiB MiB/s | CPU cores |
| --- | --- | --- | --- | --- |
| `rust` | ARMv8 SHA2, 4 messages interleaved | 677.9 | 681.2 | 1.00 |
| `rust-par` | ARMv8 SHA2, 4 messages interleaved, 10 threads | 3717.9 | 3738.1 | 8.56 |
| `rust-soft` | NEON, 8 messages per SHA-256 (2 vectors), forced | 294.4 | 294.3 | 1.00 |
| `rust-portable` | sha2, one message at a time, forced | 617.6 | 611.4 | 1.00 |
| `go` | sha256-simd/ARMv8 | 729.3 | 728.2 | 2.63 |
| `go-1core` | sha256-simd/ARMv8 | 341.6 | 343.0 | 1.00 |
| `go-stdlib` | crypto/sha256/ARMv8 | 875.8 | 867.2 | 2.69 |
| `go-nosha` | crypto/sha256/generic | 138.0 | 136.2 | 2.17 |
| `go-nosha-1core` | crypto/sha256/generic | 69.7 | 68.9 | 0.99 |
| `wasm` | wasm simd128, 4 messages per SHA-256 | 184.5 | 182.8 | 1.00 |

## Memory

Peak RSS of the whole process (Node alone is ~40 MiB); growth is peak RSS after hashing minus before. Heap is what the hasher allocated during the run (not tracked for WASM).

| Variant | Payload | Peak RSS | RSS growth | Heap allocated | Allocations |
| --- | --- | --- | --- | --- | --- |
| `rust` | 1 MiB | 1.3 MiB | 16 KiB | 16 KiB | 2 |
| `rust-par` | 1 MiB | 2.1 MiB | 64 KiB | 16 KiB | 2 |
| `go` | 1 MiB | 7.1 MiB | 720 KiB | 1.1 MiB | 234 |
| `go-1core` | 1 MiB | 5.7 MiB | 288 KiB | 1.1 MiB | 207 |
| `wasm` | 1 MiB | 49.6 MiB | 272 KiB | n/a | n/a |
| `rust` | 1 GiB | 1.3 MiB | 48 KiB | 16 KiB | 2 |
| `rust-par` | 1 GiB | 2.4 MiB | 208 KiB | 30.9 KiB | 12 |
| `go` | 1 GiB | 11.4 MiB | 912 KiB | 1032.2 MiB | 33446 |
| `go-1core` | 1 GiB | 27.2 MiB | 15.3 MiB | 1032.1 MiB | 33219 |
| `wasm` | 1 GiB | 53.3 MiB | 3 MiB | n/a | n/a |
