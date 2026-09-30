//! Native CLI around rs/commp for compare/run.js
//!
//! Same commands and output formats as compare/go/main.go (see there), minus
//! `gen`, whose Lotus payloads come from the Go CLI.

use std::alloc::{GlobalAlloc, Layout, System};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::Instant;

use commp::CommPHasher;

/// Stdin is fed to the hasher in this cycle of sizes to exercise partial quads
const READ_SIZES: [usize; 8] = [1, 31, 127, 128, 1000, 4096, 65536, 1 << 20];

/// Counts heap allocations, to compare with Go's `runtime.MemStats`
struct Counting;

static ALLOC_BYTES: AtomicU64 = AtomicU64::new(0);
static ALLOCS: AtomicU64 = AtomicU64::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOC_BYTES.fetch_add(layout.size() as u64, Relaxed);
        ALLOCS.fetch_add(1, Relaxed);
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOC_BYTES.fetch_add(new_size as u64, Relaxed);
        ALLOCS.fetch_add(1, Relaxed);
        System.realloc(ptr, layout, new_size)
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| -> u64 {
        args.get(i)
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| fail("expected a number"))
    };
    match args.first().map(String::as_str) {
        Some("info") => println!("{{{}}}", info()),
        Some("hash") => {
            let mut out = io::stdout().lock();
            let result = hash_reader(&mut BufReader::with_capacity(1 << 20, io::stdin().lock()), None);
            write_result(&mut out, result);
        }
        Some("frames") => frames(),
        Some("bench") => bench(arg(1), arg(2) as usize, arg(3) as usize, arg(4) as usize),
        _ => fail("usage: commp-rust <info|hash|frames|bench> ..."),
    }
}

/// SHA-256 code rs/commp picks on this CPU, and how many threads hash
fn backend() -> String {
    let mut backend = commp::sha256_backend().to_string();
    if cfg!(sha2_backend = "soft") {
        backend += ", forced";
    }
    if cfg!(feature = "parallel") {
        let threads = std::thread::available_parallelism().map_or(1, |n| n.get());
        backend += &format!(", {threads} threads");
    }
    backend
}

fn info() -> String {
    format!(
        r#""impl":"rust","backend":"{}","runtime":"{}","rustflags":"{}","os":"{}","arch":"{}","deps":{{{}}}"#,
        backend(),
        env!("RUSTC_VERSION"),
        env!("COMMP_RUSTFLAGS"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        env!("COMMP_DEPS"),
    )
}

type HashResult = Result<([u8; 32], u64), String>;

/// Hash `limit` bytes of `r` (or to EOF), reading in the `READ_SIZES` cycle
fn hash_reader(r: &mut impl Read, mut limit: Option<u64>) -> HashResult {
    let mut hasher = CommPHasher::new();
    let mut buf = vec![0u8; READ_SIZES[READ_SIZES.len() - 1]];
    for i in 0.. {
        let mut n = READ_SIZES[i % READ_SIZES.len()];
        if let Some(left) = limit {
            if left == 0 {
                break;
            }
            n = n.min(left as usize);
        }
        let read = read_full(r, &mut buf[..n]);
        if read > 0 {
            hasher
                .write(&buf[..read])
                .map_err(|_| "exceeds max payload size".to_string())?;
        }
        if let Some(left) = limit.as_mut() {
            *left -= read as u64;
        }
        if read < n {
            if limit.is_some_and(|left| left > 0) {
                fail("unexpected end of input");
            }
            break;
        }
    }
    Ok(finish(&hasher))
}

/// Root and padded piece size, from the multihash digest's trailing
/// `height (u8) | root (32 bytes)`
fn finish(hasher: &CommPHasher) -> ([u8; 32], u64) {
    let digest = hasher.digest();
    let (height, root) = digest[digest.len() - 33..].split_first().unwrap();
    (root.try_into().unwrap(), 32u64 << height)
}

fn read_full(r: &mut impl Read, buf: &mut [u8]) -> usize {
    let mut filled = 0;
    while filled < buf.len() {
        match r.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => fail(&e.to_string()),
        }
    }
    filled
}

fn frames() {
    let mut input = BufReader::with_capacity(1 << 20, io::stdin().lock());
    let mut out = BufWriter::new(io::stdout().lock());
    let mut header = [0u8; 8];
    loop {
        match read_full(&mut input, &mut header) {
            0 => break,
            8 => {}
            _ => fail("truncated frame header"),
        }
        let result = hash_reader(&mut input, Some(u64::from_le_bytes(header)));
        write_result(&mut out, result);
    }
    out.flush().unwrap();
}

fn write_result(out: &mut impl Write, result: HashResult) {
    match result {
        Ok((root, padded)) => writeln!(out, "{} {padded}", hex(&root)),
        Err(e) => writeln!(out, "error: {e}"),
    }
    .unwrap();
}

fn bench(size: u64, iters: usize, buf_size: usize, chunk: usize) {
    let buf = xorshift_buffer(buf_size);
    // Warm up caches and the CPU clock
    hash_buffer(&buf, size.min(8 << 20), chunk);
    let rss_base = max_rss();

    let mut root = [0u8; 32];
    let mut padded = 0;
    let mut runs = Vec::with_capacity(iters);
    for _ in 0..iters {
        let (bytes0, allocs0) = (ALLOC_BYTES.load(Relaxed), ALLOCS.load(Relaxed));
        let ru0 = rusage();
        let start = Instant::now();
        (root, padded) = hash_buffer(&buf, size, chunk);
        let wall = start.elapsed().as_secs_f64();
        let ru1 = rusage();
        runs.push(format!(
            r#"{{"wall":{wall},"user":{},"sys":{},"allocBytes":{},"allocs":{}}}"#,
            seconds(ru1.ru_utime) - seconds(ru0.ru_utime),
            seconds(ru1.ru_stime) - seconds(ru0.ru_stime),
            ALLOC_BYTES.load(Relaxed) - bytes0,
            ALLOCS.load(Relaxed) - allocs0,
        ));
    }

    println!(
        r#"{{{},"size":{size},"chunk":{chunk},"buf":{buf_size},"root":"{}","padded":{padded},"rssBase":{rss_base},"rssPeak":{},"runs":[{}]}}"#,
        info(),
        hex(&root),
        max_rss(),
        runs.join(","),
    );
}

/// Hash `size` bytes of `buf` repeated, written `chunk` bytes at a time
fn hash_buffer(buf: &[u8], size: u64, chunk: usize) -> ([u8; 32], u64) {
    let mut hasher = CommPHasher::new();
    let mut off = 0u64;
    while off < size {
        let pos = (off % buf.len() as u64) as usize;
        let n = chunk.min(buf.len() - pos).min((size - off) as usize);
        if hasher.write(&buf[pos..pos + n]).is_err() {
            fail("exceeds max payload size");
        }
        off += n as u64;
    }
    finish(&hasher)
}

/// xorshift32 (13, 17, 5) from seed 0x9E3779B9, little-endian words
fn xorshift_buffer(size: usize) -> Vec<u8> {
    let mut buf = vec![0u8; size.next_multiple_of(4)];
    let mut x: u32 = 0x9E3779B9;
    for word in buf.chunks_exact_mut(4) {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        word.copy_from_slice(&x.to_le_bytes());
    }
    buf.truncate(size);
    buf
}

fn rusage() -> libc::rusage {
    let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut ru) } != 0 {
        fail("getrusage failed");
    }
    ru
}

/// Peak resident set size in bytes (Linux reports KiB)
fn max_rss() -> u64 {
    let rss = rusage().ru_maxrss as u64;
    if cfg!(target_os = "linux") {
        rss * 1024
    } else {
        rss
    }
}

fn seconds(tv: libc::timeval) -> f64 {
    tv.tv_sec as f64 + tv.tv_usec as f64 / 1e6
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn fail(msg: &str) -> ! {
    eprintln!("commp-rust: {msg}");
    std::process::exit(1)
}
