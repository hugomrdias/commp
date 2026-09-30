# CommP comparison across machines

MiB/s at the largest payload each machine ran (`node compare/run.js report` regenerates this file).

| Machine | CPU | SHA ext | Commit | Size | `rust` | `rust-par` | `rust-soft` | `rust-portable` | `go` | `go-1core` | `go-stdlib` | `go-nosha` | `go-nosha-1core` | `wasm` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| apple-m1-pro-darwin-arm64 | Apple M1 Pro (8P + 2E) | yes | 2926c7b530 | 1 GiB | 681 (1.0c) | 3738 (8.6c) | 294 (1.0c) | 611 (1.0c) | 728 (2.6c) | 343 (1.0c) | 867 (2.7c) | 136 (2.2c) | 69 (1.0c) | 183 (1.0c) |
