# apple-m1-pro-darwin-arm64

2026-09-30T09:04:07.351Z

|  |  |
| --- | --- |
| CPU | Apple M1 Pro (8P + 2E) |
| Cores | 10 physical, 10 logical |
| OS | Darwin 24.6.0 (darwin/arm64) |
| SHA-related CPU features | sha2 sha512 asimd ~~sve~~ ~~sve2~~ |
| Virtualized | no |
| Source | 6f65a00e04 |
| Versions | commp-wasm 0.1.0, cpufeatures 0.3.1, sha2 0.11.0, filecoin-project/go-fil-commp-hashhash v0.4.0, minio/sha256-simd v1.0.1 / => ./sha256stdlib, @commp/wasm 0.1.0, inline wasm sha256 3c1f8245ac75be88 |
| Toolchains | go version go1.27.1 darwin/arm64, rustc 1.92.0 (ded5c06cf 2025-12-08), node v26.10.0 |

## Correctness

- Lotus vectors up to 64 MiB: 804 checks, 0 failures (45 larger vectors skipped)
- Sweep up to 4 MiB: 300 payloads, 0 disagreements
- Variants: rust, rust-soft, go, go-stdlib, go-nosha, wasm

## Speed

MiB/s, median of the runs; CPU cores = (user + sys) / wall at 1 GiB.

| Variant | SHA-256 backend | 32 MiB MiB/s | 1 GiB MiB/s | CPU cores |
| --- | --- | --- | --- | --- |
| `rust` | sha2/ARMv8 | 611.5 | 612.5 | 1.00 |
| `rust-soft` | sha2/soft (forced) | 84.7 | 84.9 | 1.00 |
| `go` | sha256-simd/ARMv8 | 727.5 | 731.3 | 2.60 |
| `go-1core` | sha256-simd/ARMv8 | 341.8 | 340.0 | 1.00 |
| `go-stdlib` | crypto/sha256/ARMv8 | 874.9 | 877.4 | 2.67 |
| `go-nosha` | crypto/sha256/generic | 138.2 | 138.3 | 2.18 |
| `go-nosha-1core` | crypto/sha256/generic | 69.2 | 69.0 | 1.00 |
| `wasm` | wasm simd128, 4 messages per SHA-256 | 183.0 | 182.9 | 1.00 |

## Memory

Peak RSS of the whole process (Node alone is ~40 MiB); growth is peak RSS after hashing minus before. Heap is what the hasher allocated during the run (not tracked for WASM).

| Variant | Payload | Peak RSS | RSS growth | Heap allocated | Allocations |
| --- | --- | --- | --- | --- | --- |
| `rust` | 1 MiB | 1.3 MiB | 64 KiB | 16 KiB | 2 |
| `go` | 1 MiB | 6.8 MiB | 576 KiB | 1.1 MiB | 241 |
| `go-1core` | 1 MiB | 5.8 MiB | 336 KiB | 1.1 MiB | 207 |
| `wasm` | 1 MiB | 50 MiB | 576 KiB | n/a | n/a |
| `rust` | 1 GiB | 1.3 MiB | 80 KiB | 16 KiB | 2 |
| `go` | 1 GiB | 10.7 MiB | 944 KiB | 1032.2 MiB | 33469 |
| `go-1core` | 1 GiB | 27.3 MiB | 15.3 MiB | 1032.1 MiB | 33219 |
| `wasm` | 1 GiB | 53.3 MiB | 3.2 MiB | n/a | n/a |
