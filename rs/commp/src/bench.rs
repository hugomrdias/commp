//! Simple native benchmark for CommP
//!
//! Run with: cargo run --release --bin bench

use std::time::Instant;

// Import the library
use commp_wasm::CommPHasher;

const ITERATIONS: u32 = 100;
const DATA_SIZE: usize = 1024 * 1024; // 1 MB

fn main() {
    let data = vec![0x42u8; DATA_SIZE];
    
    // Warmup
    for _ in 0..5 {
        let mut hasher = CommPHasher::new();
        hasher.write(&data);
        let _ = hasher.root();
    }
    
    // Benchmark
    let start = Instant::now();
    for _ in 0..ITERATIONS {
        let mut hasher = CommPHasher::new();
        hasher.write(&data);
        let _ = hasher.root();
    }
    let elapsed = start.elapsed();
    
    let total_bytes = DATA_SIZE as u64 * ITERATIONS as u64;
    let ops_per_sec = ITERATIONS as f64 / elapsed.as_secs_f64();
    let mib_per_sec = (total_bytes as f64 / (1024.0 * 1024.0)) / elapsed.as_secs_f64();
    let ns_per_op = elapsed.as_nanos() as f64 / ITERATIONS as f64;
    
    println!("CommP Native Rust Benchmark");
    println!("============================");
    println!("Data size:    {} MB", DATA_SIZE / (1024 * 1024));
    println!("Iterations:   {}", ITERATIONS);
    println!("Total time:   {:.2?}", elapsed);
    println!();
    println!("Latency:      {:.0} ns/op", ns_per_op);
    println!("Throughput:   {:.0} ops/s", ops_per_sec);
    println!("Speed:        {:.1} MiB/s", mib_per_sec);
}

