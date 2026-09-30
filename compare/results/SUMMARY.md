# CommP comparison across machines

MiB/s at the largest payload each machine ran (`node compare/run.js report` regenerates this file).

| Machine | CPU | SHA ext | Commit | Size | `rust` | `rust-soft` | `go` | `go-1core` | `go-stdlib` | `go-nosha` | `go-nosha-1core` | `wasm` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| apple-m1-pro-darwin-arm64 | Apple M1 Pro (8P + 2E) | yes | 6f65a00e04 | 1 GiB | 612 (1.0c) | 85 (1.0c) | 731 (2.6c) | 340 (1.0c) | 877 (2.7c) | 138 (2.2c) | 69 (1.0c) | 183 (1.0c) |
