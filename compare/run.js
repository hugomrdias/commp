/**
 * Compare rs/commp (native and WASM) with go-fil-commp-hashhash
 *
 * Builds each implementation in several SHA-256 configurations, checks they
 * agree with each other and with the Lotus vectors, then measures speed and
 * memory. Results are written per machine to compare/results so runs on
 * different CPUs can be compared with `node compare/run.js report`.
 *
 * Usage: node compare/run.js [all|build|info|verify|bench|memory|report] [options]
 * See compare/README.md for the options.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

const DIR = import.meta.dirname
const ROOT = path.dirname(DIR)
/** Results file format; bump when fields change meaning */
const FORMAT = 2
const BUILD = path.join(DIR, '.build')
const MiB = 1024 * 1024
const GiB = 1024 * MiB

const { positionals, values: opts } = parseArgs({
  allowPositionals: true,
  options: {
    quick: { type: 'boolean', default: false },
    variants: { type: 'string' },
    sizes: { type: 'string' },
    iters: { type: 'string' },
    chunk: { type: 'string', default: '1MiB' },
    'mem-sizes': { type: 'string' },
    'vectors-max': { type: 'string' },
    'sweep-count': { type: 'string' },
    'sweep-max': { type: 'string' },
    label: { type: 'string' },
    out: { type: 'string', default: path.join(DIR, 'results') },
    help: { type: 'boolean', short: 'h', default: false },
  },
})
const command = positionals[0] ?? 'all'

if (opts.help) {
  console.log(`Usage: node compare/run.js [command] [options]

Commands:
  all        build, verify, bench and memory (default)
  build      build the Rust and Go CLIs into compare/.build
  info       print machine info and each variant's SHA-256 backend
  verify     Lotus vectors and a random sweep, across all variants
  bench      throughput and CPU use
  memory     peak RSS and heap allocations
  report     summarize every results file into results/SUMMARY.md

Options:
  --quick               smaller sizes, for a fast first look
  --variants a,b        variants to run (see compare/README.md)
  --sizes 32MiB,1GiB    bench payload sizes
  --iters N             bench runs per size (default: 3-20 by size)
  --chunk 1MiB          bytes per write() in bench
  --mem-sizes 1MiB,1GiB memory payload sizes
  --vectors-max 64MiB   largest Lotus vector to check (up to 32GiB)
  --sweep-count 300     sweep payloads
  --sweep-max 4MiB      largest sweep payload
  --label name          results file name (default: from the CPU)
  --out dir             results directory (default: compare/results)`)
  process.exit(0)
}

/** @param {string} s e.g. "64", "512KiB", "32MiB", "1GiB" */
function parseSize(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB)?$/i.exec(s.trim())
  if (!m) throw new Error(`bad size: ${s}`)
  const unit = { b: 1, kib: 1024, mib: MiB, gib: GiB }[
    (m[2] ?? 'b').toLowerCase()
  ]
  return Math.round(Number(m[1]) * unit)
}

/** @param {number} n */
function formatSize(n) {
  if (n >= GiB && n % GiB === 0) return `${n / GiB} GiB`
  if (n >= MiB) return `${+(n / MiB).toFixed(1)} MiB`
  if (n >= 1024) return `${+(n / 1024).toFixed(1)} KiB`
  return `${n} B`
}

const sizes = (/** @type {string} */ s) => s.split(',').map(parseSize)
const config = {
  sizes: sizes(opts.sizes ?? (opts.quick ? '32MiB,256MiB' : '32MiB,1GiB')),
  memSizes: sizes(
    opts['mem-sizes'] ?? (opts.quick ? '1MiB,256MiB' : '1MiB,1GiB')
  ),
  chunk: parseSize(opts.chunk),
  vectorsMax: parseSize(opts['vectors-max'] ?? (opts.quick ? '8MiB' : '64MiB')),
  sweepCount: Number(opts['sweep-count'] ?? (opts.quick ? 100 : 300)),
  sweepMax: parseSize(opts['sweep-max'] ?? '4MiB'),
  iters: opts.iters ? Number(opts.iters) : undefined,
  /** Bytes each variant hashes per size, when --iters isn't given */
  budget: opts.quick ? 512 * MiB : 2 * GiB,
}

const goArch = { x64: 'amd64', arm64: 'arm64' }[process.arch] ?? process.arch
/** GODEBUG that turns off hardware SHA-256 in crypto/sha256 */
const noSha = goArch === 'amd64' ? 'cpu.sha=off' : 'cpu.sha2=off'

/**
 * @typedef {object} Variant
 * @property {string} id
 * @property {string} desc
 * @property {'rust'|'go'|'wasm'} impl
 * @property {string} bin Build output (see `builds`)
 * @property {Record<string, string>} [env]
 * @property {boolean} [optIn] Only run when named in --variants
 * @property {boolean} [memory] Included in the memory table
 */

/** @type {Variant[]} */
const VARIANTS = [
  {
    id: 'rust',
    desc: 'Rust native, SHA-256 hardware detected at run time',
    impl: 'rust',
    bin: 'rust',
    memory: true,
  },
  {
    id: 'rust-soft',
    desc: 'Rust native, sha2 forced to its portable backend',
    impl: 'rust',
    bin: 'rust-soft',
  },
  {
    id: 'rust-native',
    desc: 'Rust native, -C target-cpu=native',
    impl: 'rust',
    bin: 'rust-native',
    optIn: true,
  },
  {
    id: 'go',
    desc: 'go-fil-commp-hashhash as released (sha256-simd)',
    impl: 'go',
    bin: 'go',
    memory: true,
  },
  {
    id: 'go-1core',
    desc: 'go-fil-commp-hashhash, GOMAXPROCS=1',
    impl: 'go',
    bin: 'go',
    env: { GOMAXPROCS: '1' },
    memory: true,
  },
  {
    id: 'go-stdlib',
    desc: 'go-fil-commp-hashhash on crypto/sha256',
    impl: 'go',
    bin: 'go-stdlib',
  },
  {
    id: 'go-nosha',
    desc: `go-fil-commp-hashhash on crypto/sha256, GODEBUG=${noSha}`,
    impl: 'go',
    bin: 'go-stdlib',
    env: { GODEBUG: noSha },
  },
  {
    id: 'go-nosha-1core',
    desc: `go-fil-commp-hashhash on crypto/sha256, GODEBUG=${noSha}, GOMAXPROCS=1`,
    impl: 'go',
    bin: 'go-stdlib',
    env: { GODEBUG: noSha, GOMAXPROCS: '1' },
  },
  ...(goArch === 'amd64'
    ? [
        /** @type {Variant} */ ({
          id: 'go-generic',
          desc: 'go-fil-commp-hashhash on crypto/sha256, no SHA-NI or AVX2',
          impl: 'go',
          bin: 'go-stdlib',
          env: { GODEBUG: 'cpu.sha=off,cpu.avx2=off' },
        }),
      ]
    : []),
  {
    id: 'wasm',
    desc: '@commp/wasm (committed inline build) in Node',
    impl: 'wasm',
    bin: 'wasm',
    memory: true,
  },
]

const selected = opts.variants
  ? opts.variants.split(',').map((id) => {
      const v = VARIANTS.find((v) => v.id === id)
      if (!v) throw new Error(`unknown variant ${id}`)
      return v
    })
  : VARIANTS.filter((v) => !v.optIn)

/** @type {Record<string, {cmd: string, args: string[], build?: () => void}>} */
const builds = {
  rust: rustBuild('rust', ''),
  'rust-soft': rustBuild('rust-soft', '--cfg sha2_backend="soft"'),
  'rust-native': rustBuild('rust-native', '-C target-cpu=native'),
  go: goBuild('go', []),
  'go-stdlib': goBuild('go-stdlib', [
    '-modfile=go.stdlib.mod',
    '-tags=stdlibsha',
  ]),
  wasm: { cmd: process.execPath, args: [path.join(DIR, 'wasm.js')] },
}

/**
 * @param {string} name
 * @param {string} rustflags
 */
function rustBuild(name, rustflags) {
  const target = path.join(BUILD, name)
  return {
    cmd: path.join(target, 'release', 'commp-rust'),
    args: [],
    build: () =>
      run(
        'cargo',
        [
          'build',
          '--quiet',
          '--release',
          '--manifest-path',
          path.join(DIR, 'rust', 'Cargo.toml'),
          '--target-dir',
          target,
        ],
        { env: { ...process.env, RUSTFLAGS: rustflags } }
      ),
  }
}

/**
 * @param {string} name
 * @param {string[]} flags
 */
function goBuild(name, flags) {
  const out = path.join(BUILD, `commp-${name}`)
  return {
    cmd: out,
    args: [],
    build: () =>
      run('go', ['build', '-trimpath', ...flags, '-o', out, '.'], {
        cwd: path.join(DIR, 'go'),
      }),
  }
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileSyncOptions} [options]
 */
function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  })
}

/** @param {string} msg */
function log(msg) {
  process.stderr.write(`${msg}\n`)
}

/** @param {Variant} v */
function variantEnv(v) {
  const env = { ...process.env }
  delete env.GODEBUG
  delete env.GOMAXPROCS
  return { ...env, ...v.env }
}

/**
 * Run a variant's CLI
 *
 * @param {Variant} v
 * @param {string[]} args
 * @param {number | 'ignore'} [stdin] File descriptor
 */
function exec(v, args, stdin = 'ignore') {
  const b = builds[v.bin]
  const res = spawnSync(b.cmd, [...b.args, ...args], {
    encoding: 'utf8',
    env: variantEnv(v),
    stdio: [stdin, 'pipe', 'pipe'],
    maxBuffer: 64 * MiB,
  })
  if (res.error) throw res.error
  if (res.status !== 0) {
    throw new Error(`${v.id} ${args.join(' ')} failed:\n${res.stderr}`)
  }
  if (res.stderr.trim()) log(`  ${v.id}: ${res.stderr.trim()}`)
  return res.stdout
}

function build() {
  fs.mkdirSync(BUILD, { recursive: true })
  // go also generates the Lotus payloads
  const needed = new Set(['go', ...selected.map((v) => v.bin)])
  for (const name of needed) {
    if (!builds[name].build) continue
    log(`building ${name}`)
    builds[name].build?.()
  }
}

/* ------------------------------------------------------------------------ */
/* Machine info                                                             */
/* ------------------------------------------------------------------------ */

/**
 * @param {string} cmd
 * @param {string[]} args
 */
function tryRun(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

/** @param {string} file */
function tryRead(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/** Code compiled or run by the CLIs; the driver itself is left out */
const SOURCE_PATHS = [
  'rs/commp',
  'packages/commp-wasm/src',
  'compare/go',
  'compare/rust',
  'compare/wasm.js',
]

/**
 * The repo commit, plus a fingerprint of uncommitted changes to the code under
 * test.
 */
function source() {
  const git = (/** @type {string[]} */ ...args) =>
    tryRun('git', ['-C', ROOT, ...args])
  const commit = git('rev-parse', 'HEAD')
  if (!commit) {
    return { commit: null, dirty: null, changes: null, id: null }
  }
  const dirty = git('status', '--porcelain', '--', ...SOURCE_PATHS) !== ''
  let changes = null
  if (dirty) {
    const hash = createHash('sha256').update(
      git('diff', 'HEAD', '--', ...SOURCE_PATHS)
    )
    const untracked = git(
      'ls-files',
      '--others',
      '--exclude-standard',
      '--',
      ...SOURCE_PATHS
    )
    for (const file of untracked.split('\n').filter(Boolean)) {
      hash.update(file).update(tryRead(path.join(ROOT, file)))
    }
    changes = hash.digest('hex').slice(0, 12)
  }
  return {
    commit,
    dirty,
    changes,
    id: changes ? `${commit}+${changes}` : commit,
  }
}

/** @param {any} src */
function formatSource(src) {
  if (!src?.commit) return 'unknown'
  const short = src.commit.slice(0, 10)
  return src.dirty ? `${short} + uncommitted changes (${src.changes})` : short
}

/** What each implementation was built from, e.g. module and crate versions */
function formatVersions(/** @type {any[]} */ variants) {
  /** @type {Map<string, Set<string>>} */
  const seen = new Map()
  for (const v of variants) {
    for (const [name, version] of Object.entries(v.deps ?? {})) {
      const short = name.replace('github.com/', '')
      if (/cpuid|x\/sys|xerrors/.test(short)) continue
      seen.set(short, (seen.get(short) ?? new Set()).add(String(version)))
    }
  }
  return [...seen]
    .map(([name, versions]) => `${name} ${[...versions].join(' / ')}`)
    .join(', ')
}

/** CPU features that pick a SHA-256 backend in one of the implementations */
const FEATURES = {
  x64: ['sha_ni', 'avx', 'avx2', 'bmi2', 'ssse3', 'sse4_1', 'avx512f'],
  arm64: ['sha2', 'sha512', 'asimd', 'sve', 'sve2'],
}

function machine() {
  const cpus = os.cpus()
  const info = {
    os: `${os.type()} ${os.release()}`,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus[0]?.model.trim() || '',
    logicalCores: os.availableParallelism(),
    physicalCores: /** @type {number | null} */ (null),
    memory: os.totalmem(),
    /** @type {Record<string, boolean>} */
    features: {},
    virtualized: /** @type {boolean | null} */ (null),
    governor: /** @type {string | null} */ (null),
    toolchains: {
      go: tryRun('go', ['version']),
      rustc: tryRun('rustc', ['--version']),
      node: process.version,
    },
  }
  const wanted = FEATURES[/** @type {'x64'|'arm64'} */ (process.arch)] ?? []

  if (process.platform === 'linux') {
    const cpuinfo = tryRead('/proc/cpuinfo')
    const field = (/** @type {string} */ name) =>
      new RegExp(`^${name}\\s*:\\s*(.*)$`, 'm').exec(cpuinfo)?.[1] ?? ''
    const flags = new Set(
      (field('flags') || field('Features')).split(/\s+/).filter(Boolean)
    )
    for (const f of wanted) info.features[f] = flags.has(f)
    info.virtualized = flags.has('hypervisor') || null
    const lscpu = tryRun('lscpu', [])
    const lsField = (/** @type {string} */ name) =>
      new RegExp(`^${name}:\\s*(.*)$`, 'm').exec(lscpu)?.[1]
    info.cpu = field('model name') || lsField('Model name') || info.cpu
    const perSocket = Number(lsField('Core\\(s\\) per (?:socket|cluster)'))
    const sockets = Number(lsField('Socket\\(s\\)') ?? 1) || 1
    if (perSocket) info.physicalCores = perSocket * sockets
    if (lsField('Hypervisor vendor')) info.virtualized = true
    info.governor =
      tryRead('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor').trim() ||
      null
  } else if (process.platform === 'darwin') {
    const sysctl = (/** @type {string} */ name) =>
      tryRun('sysctl', ['-n', name])
    info.cpu = sysctl('machdep.cpu.brand_string') || info.cpu
    info.physicalCores = Number(sysctl('hw.physicalcpu')) || null
    const perf = sysctl('hw.perflevel0.physicalcpu')
    const eff = sysctl('hw.perflevel1.physicalcpu')
    if (perf && eff) info.cpu += ` (${perf}P + ${eff}E)`
    info.virtualized = sysctl('kern.hv_vmm_present') === '1'
    if (process.arch === 'arm64') {
      const armFeature = {
        sha2: 'hw.optional.arm.FEAT_SHA256',
        sha512: 'hw.optional.arm.FEAT_SHA512',
        asimd: 'hw.optional.arm.AdvSIMD',
        sve: 'hw.optional.arm.FEAT_SVE',
        sve2: 'hw.optional.arm.FEAT_SVE2',
      }
      for (const f of wanted) {
        info.features[f] =
          sysctl(armFeature[/** @type {keyof armFeature} */ (f)]) === '1'
      }
    } else {
      const flags = new Set(
        `${sysctl('machdep.cpu.features')} ${sysctl('machdep.cpu.leaf7_features')}`
          .toLowerCase()
          .split(/\s+/)
      )
      const alias = { sha_ni: 'sha', sse4_1: 'sse4.1', avx: 'avx1.0' }
      for (const f of wanted) {
        info.features[f] = flags.has(alias[/** @type {keyof alias} */ (f)] ?? f)
      }
    }
  }
  return info
}

/** @param {ReturnType<typeof machine>} m */
function defaultLabel(m) {
  const slug = m.cpu
    .replace(/\(R\)|\(TM\)|CPU|Processor|@.*$|\(.*\)/gi, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'unknown-cpu'}-${m.platform}-${m.arch}`
}

/* ------------------------------------------------------------------------ */
/* Correctness                                                              */
/* ------------------------------------------------------------------------ */

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** Raw commP from a baga... piece CID: its last 32 bytes */
function cidRoot(/** @type {string} */ cid) {
  let bits = 0
  let value = 0
  const out = []
  for (const c of cid.slice(1)) {
    value = (value << 5) | BASE32.indexOf(c)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out.slice(-32)).toString('hex')
}

/** go-fil-commp-hashhash's testdata, from the Go module cache */
function lotusVectors() {
  const dir = run(
    'go',
    [
      'list',
      '-m',
      '-f',
      '{{.Dir}}',
      'github.com/filecoin-project/go-fil-commp-hashhash',
    ],
    { cwd: path.join(DIR, 'go') }
  ).trim()
  const cases = []
  for (const kind of ['random', 'zero', '0xCC']) {
    const text = fs.readFileSync(
      path.join(dir, 'testdata', `${kind}.txt`),
      'utf8'
    )
    for (const line of text.trim().split('\n')) {
      const [size, padded, cid] = line.split(',')
      cases.push({
        kind,
        size: Number(size),
        expected: `${cidRoot(cid)} ${padded}`,
      })
    }
  }
  return cases
}

/** Deterministic PRNG for the sweep (xorshift32) */
function prng(seed = 0x2545f491) {
  let x = seed
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 2 ** 32
  }
}

/**
 * Payload sizes around FR32 quad (127 B) and tree boundaries, plus random
 * sizes spread evenly in log scale
 */
function sweepSizes() {
  const set = new Set([65, 96, 126, 127, 128, 129, 253, 254, 255, 256])
  for (let quads = 2; quads * 127 <= config.sweepMax; quads *= 2) {
    for (const d of [-1, 0, 1]) set.add(quads * 127 + d)
    set.add(quads * 128)
  }
  const rand = prng()
  const [lo, hi] = [Math.log(65), Math.log(config.sweepMax)]
  while (set.size < config.sweepCount) {
    set.add(Math.round(Math.exp(lo + rand() * (hi - lo))))
  }
  return [...set].filter((s) => s <= config.sweepMax).sort((a, b) => a - b)
}

function verify() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'commp-compare-'))
  // GOMAXPROCS doesn't change what is computed
  const distinct = selected.filter((v) => !v.env?.GOMAXPROCS)
  const variants = distinct.length ? distinct : selected
  const goGen = /** @type {Variant} */ (VARIANTS.find((v) => v.id === 'go'))
  const result = {
    variants: variants.map((v) => v.id),
    vectors: {
      max: config.vectorsMax,
      checked: 0,
      skipped: 0,
      failures: /** @type {string[]} */ ([]),
    },
    sweep: {
      max: config.sweepMax,
      checked: 0,
      failures: /** @type {string[]} */ ([]),
    },
  }
  try {
    // Lotus vectors: exact commP and padded size
    const cases = lotusVectors()
    const run = cases.filter((c) => c.size <= config.vectorsMax)
    result.vectors.skipped = cases.length - run.length
    log(
      `verify: ${run.length} of ${cases.length} Lotus vectors (up to ${formatSize(config.vectorsMax)}) on ${variants.map((v) => v.id).join(', ')}`
    )
    const payload = path.join(tmp, 'payload')
    for (const c of run) {
      const fd = fs.openSync(payload, 'w')
      const gen = builds.go
      const res = spawnSync(gen.cmd, ['gen', c.kind, String(c.size)], {
        stdio: ['ignore', fd, 'inherit'],
        env: variantEnv(goGen),
      })
      fs.closeSync(fd)
      if (res.status !== 0) throw new Error(`gen ${c.kind} ${c.size} failed`)
      for (const v of variants) {
        const fd = fs.openSync(payload, 'r')
        const got = exec(v, ['hash'], fd).trim()
        fs.closeSync(fd)
        result.vectors.checked++
        if (got !== c.expected) {
          const msg = `${v.id} ${c.kind} ${c.size}: got ${got}, want ${c.expected}`
          result.vectors.failures.push(msg)
          log(`  FAIL ${msg}`)
        }
      }
    }

    // Sweep: all implementations agree, payloads streamed as frames
    const list = sweepSizes()
    log(
      `verify: sweep of ${list.length} payloads, 65 B to ${formatSize(config.sweepMax)}`
    )
    const framesFile = path.join(tmp, 'frames')
    const fd = fs.openSync(framesFile, 'w')
    const rand = prng(1337)
    for (const size of list) {
      const header = Buffer.alloc(8)
      header.writeBigUInt64LE(BigInt(size))
      const body = Buffer.allocUnsafe(size)
      for (let i = 0; i < size; i++) body[i] = rand() * 256
      fs.writeSync(fd, header)
      fs.writeSync(fd, body)
    }
    fs.closeSync(fd)
    /** @type {Record<string, string[]>} */
    const outputs = {}
    for (const v of variants) {
      const fd = fs.openSync(framesFile, 'r')
      outputs[v.id] = exec(v, ['frames'], fd).trim().split('\n')
      fs.closeSync(fd)
    }
    const [ref, ...others] = variants
    list.forEach((size, i) => {
      result.sweep.checked++
      for (const v of others) {
        if (outputs[v.id][i] !== outputs[ref.id][i]) {
          const msg = `${size} B: ${ref.id} ${outputs[ref.id][i]}, ${v.id} ${outputs[v.id][i]}`
          result.sweep.failures.push(msg)
          log(`  FAIL ${msg}`)
        }
      }
    })
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  const failures = result.vectors.failures.length + result.sweep.failures.length
  log(failures ? `verify: ${failures} FAILURES` : 'verify: all match')
  return result
}

/* ------------------------------------------------------------------------ */
/* Speed and memory                                                         */
/* ------------------------------------------------------------------------ */

/** @param {number[]} xs */
function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * @typedef {object} BenchRun
 * @property {number} wall
 * @property {number} user
 * @property {number} sys
 * @property {number | null} allocBytes
 * @property {number | null} allocs
 */

/**
 * @param {Variant} v
 * @param {number} size
 * @param {number} iters
 * @param {number} buf
 */
function benchOne(v, size, iters, buf) {
  const out = JSON.parse(
    exec(v, [
      'bench',
      String(size),
      String(iters),
      String(buf),
      String(config.chunk),
    ])
  )
  /** @type {BenchRun[]} */
  const runs = out.runs
  const wall = median(runs.map((r) => r.wall))
  const cpu = median(runs.map((r) => (r.user + r.sys) / r.wall))
  return {
    variant: v.id,
    backend: out.backend,
    runtime: out.runtime,
    size,
    iters,
    mibps: size / MiB / wall,
    cores: cpu,
    root: out.root,
    padded: out.padded,
    rssBase: out.rssBase,
    rssPeak: out.rssPeak,
    allocBytes: runs.at(-1)?.allocBytes ?? null,
    allocs: runs.at(-1)?.allocs ?? null,
    runs,
  }
}

function bench() {
  const results = []
  for (const size of config.sizes) {
    const iters =
      config.iters ??
      Math.min(20, Math.max(3, Math.round(config.budget / size)))
    for (const v of selected) {
      process.stderr.write(`bench: ${v.id} ${formatSize(size)} x${iters} ... `)
      const r = benchOne(v, size, iters, Math.min(size, 16 * MiB))
      log(`${r.mibps.toFixed(1)} MiB/s, ${r.cores.toFixed(2)} cores`)
      results.push(r)
    }
    const roots = new Set(
      results.filter((r) => r.size === size).map((r) => r.root)
    )
    if (roots.size > 1)
      log(`bench: WARNING roots differ at ${formatSize(size)}`)
  }
  return results
}

function memory() {
  const results = []
  for (const size of config.memSizes) {
    for (const v of selected.filter((v) => v.memory)) {
      process.stderr.write(`memory: ${v.id} ${formatSize(size)} ... `)
      // Small buffer and chunks, so the input itself barely counts
      const r = benchOne(v, size, 1, Math.min(size, 64 * 1024))
      log(`${formatSize(r.rssPeak)} peak RSS`)
      results.push(r)
    }
  }
  return results
}

/* ------------------------------------------------------------------------ */
/* Reports                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * @param {string[]} head
 * @param {(string|number)[][]} rows
 */
function table(head, rows) {
  const line = (/** @type {(string|number)[]} */ cells) =>
    `| ${cells.join(' | ')} |`
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n')
}

/** @param {any} r Results file contents */
function markdown(r) {
  const m = r.machine
  const features = Object.entries(m.features)
    .map(([k, on]) => (on ? k : `~~${k}~~`))
    .join(' ')
  const lines = [
    `# ${r.label}`,
    '',
    `${r.date}`,
    '',
    table(
      ['', ''],
      [
        ['CPU', m.cpu],
        [
          'Cores',
          `${m.physicalCores ?? '?'} physical, ${m.logicalCores} logical`,
        ],
        ['OS', `${m.os} (${m.platform}/${m.arch})`],
        ['SHA-related CPU features', features || 'unknown'],
        [
          'Virtualized',
          m.virtualized == null ? 'unknown' : m.virtualized ? 'yes' : 'no',
        ],
        ...(m.governor ? [['CPU governor', m.governor]] : []),
        ['Source', formatSource(r.source)],
        ['Versions', formatVersions(r.variants ?? [])],
        [
          'Toolchains',
          `${m.toolchains.go}, ${m.toolchains.rustc}, node ${m.toolchains.node}`,
        ],
      ]
    ),
  ]
  if (r.verify) {
    const v = r.verify
    lines.push(
      '',
      '## Correctness',
      '',
      `- Lotus vectors up to ${formatSize(v.vectors.max)}: ${v.vectors.checked} checks, ${v.vectors.failures.length} failures (${v.vectors.skipped} larger vectors skipped)`,
      `- Sweep up to ${formatSize(v.sweep.max)}: ${v.sweep.checked} payloads, ${v.sweep.failures.length} disagreements`,
      `- Variants: ${v.variants.join(', ')}`,
      ...[...v.vectors.failures, ...v.sweep.failures].map(
        (f) => `  - FAIL ${f}`
      )
    )
  }
  if (r.bench?.length) {
    const benchSizes = [
      ...new Set(r.bench.map((/** @type {any} */ b) => b.size)),
    ]
    const ids = [...new Set(r.bench.map((/** @type {any} */ b) => b.variant))]
    const largest = benchSizes.at(-1)
    lines.push(
      '',
      '## Speed',
      '',
      `MiB/s, median of the runs; CPU cores = (user + sys) / wall at ${formatSize(largest)}.`,
      '',
      table(
        [
          'Variant',
          'SHA-256 backend',
          ...benchSizes.map((s) => `${formatSize(s)} MiB/s`),
          'CPU cores',
        ],
        ids.map((id) => {
          const of = (/** @type {number} */ s) =>
            r.bench.find(
              (/** @type {any} */ b) => b.variant === id && b.size === s
            )
          return [
            `\`${id}\``,
            of(largest)?.backend ?? '',
            ...benchSizes.map((s) => of(s)?.mibps.toFixed(1) ?? ''),
            of(largest)?.cores.toFixed(2) ?? '',
          ]
        })
      )
    )
  }
  if (r.memory?.length) {
    lines.push(
      '',
      '## Memory',
      '',
      'Peak RSS of the whole process (Node alone is ~40 MiB); growth is peak RSS after hashing minus before. Heap is what the hasher allocated during the run (not tracked for WASM).',
      '',
      table(
        [
          'Variant',
          'Payload',
          'Peak RSS',
          'RSS growth',
          'Heap allocated',
          'Allocations',
        ],
        r.memory.map((/** @type {any} */ b) => [
          `\`${b.variant}\``,
          formatSize(b.size),
          formatSize(b.rssPeak),
          formatSize(b.rssPeak - b.rssBase),
          b.allocBytes == null ? 'n/a' : formatSize(b.allocBytes),
          b.allocs ?? 'n/a',
        ])
      )
    )
  }
  return `${lines.join('\n')}\n`
}

/** Cross-machine summary of every results file */
function report() {
  const files = fs
    .readdirSync(opts.out)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const r = JSON.parse(fs.readFileSync(path.join(opts.out, f), 'utf8'))
      // Re-render, so report format changes apply to existing results
      fs.writeFileSync(
        path.join(opts.out, f.replace(/\.json$/, '.md')),
        markdown(r)
      )
      return r
    })
    .filter((r) => r.bench?.length)
  if (!files.length) {
    log(`no bench results in ${opts.out}`)
    return
  }
  const ids = [
    ...new Set(
      files.flatMap((r) =>
        (r.bench ?? []).map((/** @type {any} */ b) => b.variant)
      )
    ),
  ]
  const byId = (/** @type {any} */ r, /** @type {string} */ id) => {
    const rows = (r.bench ?? []).filter(
      (/** @type {any} */ b) => b.variant === id
    )
    return rows.sort(
      (/** @type {any} */ a, /** @type {any} */ b) => b.size - a.size
    )[0]
  }
  const text = [
    '# CommP comparison across machines',
    '',
    'MiB/s at the largest payload each machine ran (`node compare/run.js report` regenerates this file).',
    '',
    table(
      [
        'Machine',
        'CPU',
        'SHA ext',
        'Commit',
        'Size',
        ...ids.map((id) => `\`${id}\``),
      ],
      files.map((r) => {
        const f = r.machine.features
        const sha = f.sha_ni ?? f.sha2
        return [
          r.label,
          r.machine.cpu,
          sha == null ? '?' : sha ? 'yes' : 'no',
          formatSource(r.source),
          formatSize(
            Math.max(...(r.bench ?? []).map((/** @type {any} */ b) => b.size))
          ),
          ...ids.map((id) => {
            const b = byId(r, id)
            return b ? `${b.mibps.toFixed(0)} (${b.cores.toFixed(1)}c)` : ''
          }),
        ]
      })
    ),
    '',
  ].join('\n')
  fs.writeFileSync(path.join(opts.out, 'SUMMARY.md'), text)
  console.log(text)
}

/* ------------------------------------------------------------------------ */

/** Update this machine's results file, keeping sections not rerun */
function save(/** @type {any} */ update) {
  fs.mkdirSync(opts.out, { recursive: true })
  const base = path.join(opts.out, update.label)
  let result = update
  const old = fs.existsSync(`${base}.json`)
    ? JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'))
    : null
  // Only combine sections measured from the same code
  if (
    old &&
    update.source.id &&
    old.version === update.version &&
    old.source?.id === update.source.id
  ) {
    result = {
      ...old,
      ...Object.fromEntries(
        Object.entries(update).filter(([, v]) => v !== undefined)
      ),
    }
  } else if (old) {
    log(`\n${base}.json was measured from other code; replacing it`)
  }
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(result, null, 2)}\n`)
  fs.writeFileSync(`${base}.md`, markdown(result))
  log(`\nwrote ${path.relative(process.cwd(), base)}.{json,md}`)
  return result
}

const m = machine()
const label = opts.label ?? defaultLabel(m)

switch (command) {
  case 'build':
    build()
    break
  case 'info':
    build()
    console.log(JSON.stringify(m, null, 2))
    for (const v of selected)
      console.log(v.id.padEnd(16), exec(v, ['info']).trim())
    break
  case 'report':
    report()
    break
  case 'verify':
  case 'bench':
  case 'memory':
  case 'all': {
    build()
    const result = {
      version: FORMAT,
      label,
      date: new Date().toISOString(),
      source: source(),
      machine: m,
      config,
      variants: selected.map((v) => ({
        id: v.id,
        desc: v.desc,
        ...JSON.parse(exec(v, ['info'])),
      })),
      verify: command === 'verify' || command === 'all' ? verify() : undefined,
      bench: command === 'bench' || command === 'all' ? bench() : undefined,
      memory: command === 'memory' || command === 'all' ? memory() : undefined,
    }
    console.log(`\n${markdown(save(result))}`)
    const failed =
      (result.verify?.vectors.failures.length ?? 0) +
      (result.verify?.sweep.failures.length ?? 0)
    process.exitCode = failed ? 1 : 0
    break
  }
  default:
    log(`unknown command ${command}`)
    process.exitCode = 2
}
