# Rust vs Go CommP comparison

Compares this repo's Rust implementation (native and WASM) with
[go-fil-commp-hashhash](https://github.com/filecoin-project/go-fil-commp-hashhash)
for correctness, speed and memory. Each machine gets its own results file, so
you can compare CPUs, instruction sets and SHA extensions.

Most of the cost is SHA-256, so results depend on the CPU far more than on the
code. On CPUs with SHA extensions (x86 SHA-NI, ARMv8 SHA2) both implementations
use hardware SHA. On CPUs without them, each falls back to a different software
implementation. Each variant below either uses a CPU's SHA extension or has it
turned off, so a single machine shows both cases.

## Running

You need Go ≥ 1.25, Rust via [rustup](https://rustup.rs/) (it installs the
pinned 1.92.0 toolchain on first build) and Node ≥ 24. Linux and macOS are
supported; on Windows use WSL.

```bash
pnpm compare --quick
```

`--quick` takes about 2 minutes. Leave it off for the full run: 1 GiB payloads,
Lotus vectors up to 64 MiB, and a 300-payload sweep. The full run takes about
5 minutes with SHA extensions and longer without them. Both runs write
`compare/results/<cpu>-<os>-<arch>.{json,md}` and print the Markdown.

To compare machines, commit each machine's results file, then run:

```bash
node compare/run.js report
```

This writes `compare/results/SUMMARY.md`, with one row per machine. It also
regenerates each machine's `.md` from its JSON.

### On GitHub runners

The [Compare workflow](../.github/workflows/compare.yml) runs by hand (Actions →
Compare → Run workflow) on `ubuntu-latest` (x64), `ubuntu-24.04-arm`,
`macos-latest` (Apple Silicon) and `macos-15-intel`. Nothing is committed. The
run summary shows the cross-machine table plus each runner's full results, and
the JSON is attached as the `compare-results` artifact. Shared runners are
noisy VMs, so treat their numbers as rough.

### Commands and options

`node compare/run.js [command] [options]`. Run `node compare/run.js --help`
for the full list.

| Command | |
| --- | --- |
| `all` (default) | build, verify, bench, memory |
| `info` | machine info and the SHA-256 backend each variant picked |
| `verify` | Lotus vectors plus a random sweep, on every variant |
| `bench` | throughput and CPU cores used |
| `memory` | peak RSS and heap allocations |
| `report` | cross-machine `SUMMARY.md` |

Rerunning one command updates only its section of the machine's results file,
as long as the code under test hasn't changed. Otherwise the file is replaced,
so one file never mixes numbers from different code.
Useful options: `--variants rust,go`, `--sizes 32MiB,4GiB`, `--iters 5`,
`--vectors-max 1GiB` (vectors go up to 32 GiB; all of them total 302 GiB),
`--label name`.

## Variants

| Variant | What runs | SHA-256 |
| --- | --- | --- |
| `rust` | `rs/commp` native, one thread | sha2 crate: SHA-NI / ARMv8 SHA2 if the CPU has them, else portable |
| `rust-soft` | same, built with `--cfg sha2_backend="soft"` | portable only |
| `rust-native` (opt-in) | same, built with `-C target-cpu=native` | as `rust` |
| `go` | go-fil-commp-hashhash as released | sha256-simd: SHA-NI / ARMv8 SHA2, else hands off to `crypto/sha256` |
| `go-1core` | same, `GOMAXPROCS=1` | as `go` |
| `go-stdlib` | go-fil-commp-hashhash with sha256-simd swapped for `crypto/sha256` | SHA-NI, else AVX2, else generic (amd64); ARMv8 SHA2, else generic (arm64) |
| `go-nosha` | `go-stdlib`, `GODEBUG=cpu.sha=off` (amd64) or `cpu.sha2=off` (arm64) | AVX2 or generic |
| `go-nosha-1core` | same, `GOMAXPROCS=1` | as `go-nosha` |
| `go-generic` (amd64 only) | `go-stdlib`, `GODEBUG=cpu.sha=off,cpu.avx2=off` | generic |
| `wasm` | `@hugomrdias/commp-wasm` (the committed inline build) in Node | 4-lane SIMD128 in WASM, no hardware SHA |

Every variant reports the backend it chose (the `SHA-256 backend` column), so a
results file shows what each run actually used.

The go-fil-commp-hashhash library hashes each tree layer in its own goroutine,
so `go` uses about 2.5 to 3 cores. The `-1core` variants measure it on a single
core, like the Rust implementation. sha256-simd picks its backend when it
loads and ignores `GODEBUG`. That is why the SHA-off variants run a second Go
binary on `crypto/sha256`. That binary is built with `-modfile=go.stdlib.mod`,
which points sha256-simd at [go/sha256stdlib](go/sha256stdlib).

## What is measured

- **Correctness**: go-fil-commp-hashhash ships 179 Lotus-generated vectors
  (random, zero and 0xCC payloads, 96 B to 32 GiB). The Go CLI regenerates each
  payload, and every variant must produce the expected commP and padded size.
  A sweep then streams 65 B to 4 MiB payloads through all variants: sizes
  around FR32 and tree boundaries, plus random sizes. All variants must agree.
  Input is fed to the hashers in sizes that cycle from 1 B to 1 MiB, so writes
  land on partial-quad boundaries. Go refuses payloads under 65 bytes, so the
  sweep starts at 65.
- **Speed**: each CLI hashes a payload of the given size, built by repeating a
  16 MiB xorshift32 buffer written 1 MiB at a time. Data generation and process
  startup are excluded, and a warm-up run comes first. The table shows the
  median over runs. CPU cores is user plus system CPU time divided by wall
  time. Every implementation must also return the same root for each size.
- **Memory**: peak RSS from `getrusage` of each CLI process, streaming 64 KiB
  writes. It also reports heap allocations made while hashing: Go's
  `runtime.MemStats` and a counting allocator in Rust. WASM heap allocations
  aren't tracked, and Node's own ~40 MiB dominates its RSS.

## Tips for stable numbers

- Close heavy apps. Plug laptops in, since battery mode throttles.
- On Linux, set the `performance` governor. The results file records it.
- Cloud VMs: note the instance type in `--label`. Shared vCPUs are noisy, so
  run twice.
- Each run records the CPU model, core counts, SHA-related CPU flags
  (`sha_ni`, `avx2`, `sha2`, …), whether it runs virtualized, and the toolchain
  versions.
- Each run also records what was measured: the repo commit, and a fingerprint
  of any uncommitted changes to `rs/commp`, `packages/commp-wasm/src` or the
  CLIs. It also records the go-fil-commp-hashhash, sha256-simd and sha2
  versions, the `@hugomrdias/commp-wasm` version, and a hash of its inline WASM. Commit
  before a run you plan to share, so the results point at a real commit.

## Layout

```text
compare/
├── run.js        driver: build, machine info, verify, bench, memory, report
├── wasm.js       CLI around packages/commp-wasm
├── go/           CLI around go-fil-commp-hashhash (+ go.stdlib.mod, sha256stdlib/)
├── rust/         CLI around rs/commp (separate crate, library untouched)
└── results/      one <label>.{json,md} per machine, SUMMARY.md
```

All three CLIs share the same commands (`info`, `hash`, `frames`,
`bench <size> <iters> <buf> <chunk>`), so you can also run them by hand after
`node compare/run.js build`. For example:

```bash
compare/.build/commp-go gen random 1016 | compare/.build/rust/release/commp-rust hash
```
