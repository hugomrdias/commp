/**
 * Benchmark comparing all CommP implementations including inline WASM
 */

import * as Hasher from '@web3-storage/data-segment/multihash'
import { Bench, formatNumber } from 'tinybench'
import * as HasherFast from './ts/npm-commp-js/src/index.js'
import {
	create as createWasm,
	root as wasmRoot,
} from './ts/npm-commp-wasm/src/index.js'

const bench = new Bench({ name: 'commp', time: 100, iterations: 250 })
const oneMB = new Uint8Array(1024 * 1024).fill(4)

async function run() {
	bench
		.add('1MB - original JS', () => {
			const hasher = Hasher.create()
			hasher.write(oneMB)
			hasher.digest()
		})
		.add('1MB - fast JS (@webbuf/sha256)', () => {
			const hasher = HasherFast.create()
			hasher.write(oneMB)
			hasher.digest()
		})
		.add('1MB - Rust WASM (inline)', () => {
			const hasher = createWasm()
			hasher.write(oneMB)
			hasher.digest()
			hasher.free()
		})
		.add('1MB - Rust WASM one-shot', () => {
			wasmRoot(oneMB)
		})

	await bench.run()
}

await run()
const mToNs = (ms) => Number(ms) * 1e6
console.table(
	bench.table((task) => {
		const MiB = 1024 * 1024
		const speed = (oneMB.length * task.result.throughput.mean) / MiB

		return {
			'Task Name': task.name,
			'Latency avg (ns)': `${formatNumber(mToNs(task.result.latency.mean))} ± ${task.result.latency.rme.toFixed(2)}%`,
			'ops/s': `${Math.round(task.result.throughput.mean)} ± ${task.result.throughput.rme.toFixed(2)}%`,
			'MiB/s': speed.toFixed(2),
		}
	}),
)

const results = bench.tasks
	.map((t) => ({
		name: t.name,
		mibPerSec: (oneMB.length * t.result.throughput.mean) / (1024 * 1024),
	}))
	.sort((a, b) => b.mibPerSec - a.mibPerSec)

console.log('\n🏆 Ranking:')
const baseline = results.find((r) => r.name.includes('original')).mibPerSec
for (const r of results) {
	const speedup = (r.mibPerSec / baseline).toFixed(2)
	console.log(
		`  ${r.mibPerSec.toFixed(1).padStart(5)} MiB/s (${speedup}x) - ${r.name}`,
	)
}

process.exit(0)
