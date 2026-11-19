# CommP comparison across machines

MiB/s at the largest payload each machine ran (`node compare/run.js report` regenerates this file).

| Machine | CPU | SHA ext | Commit | Size | `rust` | `rust-par` | `rust-soft` | `go` | `go-1core` | `go-stdlib` | `go-nosha` | `go-nosha-1core` | `wasm` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| apple-m1-pro-darwin-arm64 | Apple M1 Pro (8P + 2E) | yes | 7069a6df8a + uncommitted changes (17a7cb5af735) | 1 GiB | 711 (1.0c) | 3779 (8.6c) | 300 (1.0c) | 718 (2.6c) | 339 (1.0c) | 823 (2.7c) | 136 (2.2c) | 70 (1.0c) | 170 (1.0c) |
