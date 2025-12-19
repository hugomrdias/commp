import { blake3 } from "@noble/hashes/blake3.js";
import { sha256 } from "@noble/hashes/sha2.js";

import * as Hasher from "@web3-storage/data-segment/multihash";
import { blake3Hash, blake3Mac, doubleBlake3Hash } from "@webbuf/blake3";
import { WebBuf } from "@webbuf/webbuf";
import * as HasherWasm from "fr32-sha2-256-trunc254-padded-binary-tree-multihash";
import { Bench, formatNumber } from "tinybench";
import * as HasherFast from "./ts/src/commp/index.js";

const bench = new Bench({ name: "sha256", time: 100, iterations: 250 });
const oneMB = new Uint8Array(1024 * 1024).fill(4);
const oneMBWebBuf = WebBuf.fromUint8Array(oneMB);
const eightKB = new Uint8Array(8 * 1024).fill(3);
const bytes64 = new Uint8Array(64).fill(2);

async function run() {
	bench
		// .add('1MB - noble', () => {
		//   sha256(oneMB)
		// })
		.add("1MB - commp", () => {
			const hasher = Hasher.create();
			hasher.write(oneMB);
			hasher.digest();
		})
		.add("1MB - commp chunked", () => {
			const hasher = Hasher.create();
			// We'll get slightly better performance by writing in chunks to let the
			// hasher do its work incrementally
			const chunkSize = 2048;
			for (let i = 0; i < oneMB.length; i += chunkSize) {
				hasher.write(oneMB.subarray(i, i + chunkSize));
			}
			hasher.digest();
		})
		.add("1MB - commp-wasm chunked", () => {
			const hasher = HasherWasm.create();
			const chunkSize = 2048;
			for (let i = 0; i < oneMB.length; i += chunkSize) {
				hasher.write(oneMB.subarray(i, i + chunkSize));
			}
			const digest = new Uint8Array(hasher.multihashByteLength());
			hasher.digestInto(digest, 0, true);
			hasher.free();
		})
		.add("1MB - commp-fast", () => {
			const hasher = HasherFast.create();
			hasher.write(oneMB);
			hasher.digest();
		})
		.add("1MB - commp-fast chunked", () => {
			const hasher = HasherFast.create();
			const chunkSize = 2048;
			for (let i = 0; i < oneMB.length; i += chunkSize) {
				hasher.write(oneMB.subarray(i, i + chunkSize));
			}
			hasher.digest();
		});
	// .add('1MB - blake3', () => {
	//   blake3(oneMB)
	// })
	// .add('1MB - @webbuf/blake3 wasm', () => {
	//   blake3Hash(oneMBWebBuf)
	// })
	// .add(
	//   '1MB - webcrypto',
	//   async () => {
	//     await crypto.subtle.digest('SHA-256', oneMB)
	//   },
	//   { async: true }
	// )
	// .add('8KB - noble', () => {
	//   sha256(eightKB)
	// })
	// .add(
	//   '8KB - webcrypto',
	//   async () => {
	//     await crypto.subtle.digest('SHA-256', eightKB)
	//   },
	//   { async: true }
	// )
	// .add('64B - noble', () => {
	//   sha256(bytes64)
	// })
	// .add(
	//   '64B - webcrypto',
	//   async () => {
	//     await crypto.subtle.digest('SHA-256', bytes64)
	//   },
	//   { async: true }
	// )
	await bench.run();
}

await run();
const mToNs = (ms) => Number(ms) * 1e6;
console.table(
	bench.table((task) => {
		const MiB = 1024 * 1024;
		const bytesPerOp = task.name.includes("1MB")
			? oneMB.length
			: task.name.includes("8KB")
				? eightKB.length
				: bytes64.length;
		const speed = (bytesPerOp * task.result.throughput.mean) / MiB;

		return {
			"Task Name": task.name,
			"Latency avg (ns)": `${formatNumber(mToNs(task.result.latency.mean))} \xb1 ${task.result.latency.rme.toFixed(2)}%`,
			"Latency med (ns)": `${formatNumber(mToNs(task.result.latency.p50))} \xb1 ${formatNumber(mToNs(task.result.latency.mad))}`,
			"Throughput avg (ops/s)": `${Math.round(task.result.throughput.mean).toString()} \xb1 ${task.result.throughput.rme.toFixed(2)}%`,
			"Throughput med (ops/s)": `${Math.round(task.result.throughput.p50).toString()} \xb1 ${Math.round(task.result.throughput.mad).toString()}`,
			Samples: task.result.latency.samplesCount,
			"MiB/s": speed.toFixed(2),
		};
	}),
);
// const hasher = Hasher.create()
// hasher.write(oneMB)
// const digest = hasher.digest()
// console.log(digest)
process.exit(0);
