/**
 * Benchmark comparing all CommP implementations including new Rust/WASM
 */

import * as Hasher from "@web3-storage/data-segment/multihash";
import * as HasherWasm from "fr32-sha2-256-trunc254-padded-binary-tree-multihash";
// New Rust/WASM implementation
import { createRequire } from "module";
import { Bench, formatNumber } from "tinybench";
import * as HasherFast from "./ts/src/commp/index.js";

const require = createRequire(import.meta.url);
const {
	CommPHasher,
	root: rustRoot,
} = require("./ts/npm-commp-wasm/pkg/commp_wasm.js");

const bench = new Bench({ name: "commp", time: 100, iterations: 250 });
const oneMB = new Uint8Array(1024 * 1024).fill(4);
const eightKB = new Uint8Array(8 * 1024).fill(3);

async function run() {
	bench
		.add("1MB - original JS", () => {
			const hasher = Hasher.create();
			hasher.write(oneMB);
			hasher.digest();
		})
		.add("1MB - original JS chunked", () => {
			const hasher = Hasher.create();
			const chunkSize = 2048;
			for (let i = 0; i < oneMB.length; i += chunkSize) {
				hasher.write(oneMB.subarray(i, i + chunkSize));
			}
			hasher.digest();
		})
		.add("1MB - fast JS", () => {
			const hasher = HasherFast.create();
			hasher.write(oneMB);
			hasher.digest();
		})
		.add("1MB - fast JS chunked", () => {
			const hasher = HasherFast.create();
			const chunkSize = 2048;
			for (let i = 0; i < oneMB.length; i += chunkSize) {
				hasher.write(oneMB.subarray(i, i + chunkSize));
			}
			hasher.digest();
		})
		.add("1MB - existing WASM chunked", () => {
			const hasher = HasherWasm.create();
			const chunkSize = 2048;
			for (let i = 0; i < oneMB.length; i += chunkSize) {
				hasher.write(oneMB.subarray(i, i + chunkSize));
			}
			const digest = new Uint8Array(hasher.multihashByteLength());
			hasher.digestInto(digest, 0, true);
			hasher.free();
		})
		.add("1MB - NEW Rust WASM", () => {
			const hasher = new CommPHasher();
			hasher.write(oneMB);
			hasher.root();
			hasher.free();
		})
		.add("1MB - NEW Rust WASM chunked", () => {
			const hasher = new CommPHasher();
			const chunkSize = 2048;
			for (let i = 0; i < oneMB.length; i += chunkSize) {
				hasher.write(oneMB.subarray(i, i + chunkSize));
			}
			hasher.root();
			hasher.free();
		})
		.add("1MB - NEW Rust one-shot", () => {
			rustRoot(oneMB);
		});

	await bench.run();
}

await run();
const mToNs = (ms) => Number(ms) * 1e6;
console.table(
	bench.table((task) => {
		const MiB = 1024 * 1024;
		const bytesPerOp = oneMB.length;
		const speed = (bytesPerOp * task.result.throughput.mean) / MiB;

		return {
			"Task Name": task.name,
			"Latency avg (ns)": `${formatNumber(mToNs(task.result.latency.mean))} ± ${task.result.latency.rme.toFixed(2)}%`,
			"ops/s": `${Math.round(task.result.throughput.mean)} ± ${task.result.throughput.rme.toFixed(2)}%`,
			"MiB/s": speed.toFixed(2),
		};
	}),
);

console.log("\n🏆 Summary:");
const results = bench.tasks
	.map((t) => ({
		name: t.name,
		opsPerSec: t.result.throughput.mean,
	}))
	.sort((a, b) => b.opsPerSec - a.opsPerSec);

const baseline = results.find(
	(r) => r.name.includes("original JS") && !r.name.includes("chunked"),
).opsPerSec;
for (const r of results) {
	const speedup = (r.opsPerSec / baseline).toFixed(2);
	console.log(`  ${r.name}: ${speedup}x`);
}

process.exit(0);
