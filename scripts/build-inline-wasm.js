#!/usr/bin/env node
/**
 * Build script to create inline base64 WASM module
 *
 * This converts the wasm-pack output to a single JS file with
 * the WASM binary embedded as base64, similar to how @webbuf/* packages work.
 *
 * Benefits:
 * - No separate .wasm file to load
 * - Synchronous instantiation (no async init)
 * - Works in Node.js, browsers, Deno, Bun without special handling
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(__dirname, '../ts/npm-commp-wasm/pkg-bundler')
const outDir = join(__dirname, '../ts/npm-commp-wasm/src/inline')

// Read the wasm binary and base64 encode it
const wasmPath = join(pkgDir, 'commp_wasm_bg.wasm')
const wasmBinary = readFileSync(wasmPath)
const wasmBase64 = wasmBinary.toString('base64')

console.log(`WASM binary size: ${wasmBinary.length} bytes`)
console.log(`Base64 size: ${wasmBase64.length} chars`)

// Read the bg.js file to extract the bindings
const bgJsPath = join(pkgDir, 'commp_wasm_bg.js')
const bgJs = readFileSync(bgJsPath, 'utf-8')

// Create output directory
mkdirSync(outDir, { recursive: true })

// Generate the inline wasm loader
const wasmLoaderContent = `// Auto-generated - do not edit
// WASM binary embedded as base64 for synchronous loading

import * as commp_wasm_bg from './commp_wasm_bg.js';

const wasmBase64 = "${wasmBase64}";

// Decode base64 to Uint8Array
function base64ToBytes(base64) {
  if (typeof atob === 'function') {
    // Browser / Deno
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  } else {
    // Node.js
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
}

const wasmBinary = base64ToBytes(wasmBase64);
const wasmModule = new WebAssembly.Module(wasmBinary);
const importObject = { './commp_wasm_bg.js': commp_wasm_bg };
const wasm = new WebAssembly.Instance(wasmModule, importObject).exports;

export { wasm };
`

writeFileSync(join(outDir, 'commp_wasm_bg.wasm.js'), wasmLoaderContent)
console.log(`Created: ${join(outDir, 'commp_wasm_bg.wasm.js')}`)

// Copy and modify the bg.js file - we need to add __wbg_set_wasm export
let modifiedBgJs = bgJs

// Add setter for wasm if not present
if (!modifiedBgJs.includes('__wbg_set_wasm')) {
  modifiedBgJs = `let wasm;
export function __wbg_set_wasm(val) {
  wasm = val;
}

${modifiedBgJs.replace(/\bwasm\./g, 'wasm.')}`
}

writeFileSync(join(outDir, 'commp_wasm_bg.js'), modifiedBgJs)
console.log(`Created: ${join(outDir, 'commp_wasm_bg.js')}`)

// Create the main entry point
const mainContent = `// Auto-generated - do not edit
// CommP WASM with inline base64 encoding

import { wasm } from "./commp_wasm_bg.wasm.js";
export * from "./commp_wasm_bg.js";
import { __wbg_set_wasm } from "./commp_wasm_bg.js";

__wbg_set_wasm(wasm);

// Run wasm start function if present
if (wasm.__wbindgen_start) {
  wasm.__wbindgen_start();
}
`

writeFileSync(join(outDir, 'commp_wasm.js'), mainContent)
console.log(`Created: ${join(outDir, 'commp_wasm.js')}`)

console.log('\n✅ Done! Inline WASM module created at:', outDir)
