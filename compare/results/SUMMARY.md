# CommP comparison across machines

MiB/s at the largest payload each machine ran (`node compare/run.js report` regenerates this file).

| Machine | CPU | SHA ext | Commit | Size | `rust` | `rust-par` | `rust-soft` | `rust-portable` | `go` | `go-1core` | `go-stdlib` | `go-nosha` | `go-nosha-1core` | `wasm` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| apple-m1-pro-darwin-arm64 | Apple M1 Pro (8P + 2E) | yes | d9da417bc6 | 1 GiB | 719 (1.0c) | 3719 (8.5c) | 303 (1.0c) | 652 (1.0c) | 710 (2.6c) | 340 (1.0c) | 864 (2.7c) | 137 (2.2c) | 70 (1.0c) | 185 (1.0c) |
