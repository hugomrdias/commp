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
 * - Lazy compilation on first use, so importing never compiles WebAssembly
 *   (keeps imports working under a Content-Security-Policy without
 *   'wasm-unsafe-eval')
 * - Works in Node.js, browsers, Deno, Bun without special handling
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(__dirname, '../pkg-bundler')
const outDir = join(__dirname, '../src/inline')

// Read the wasm binary and base64 encode it
const wasmPath = join(pkgDir, 'commp_bg.wasm')
const wasmBinary = readFileSync(wasmPath)
const wasmBase64 = wasmBinary.toString('base64')

console.log(`WASM binary size: ${wasmBinary.length} bytes`)
console.log(`Base64 size: ${wasmBase64.length} chars`)

// Read the bg.js file to extract the bindings
const bgJsPath = join(pkgDir, 'commp_bg.js')
const bgJs = readFileSync(bgJsPath, 'utf-8')

// Create output directory
mkdirSync(outDir, { recursive: true })

// Generate the inline wasm loader
const wasmLoaderContent = `// Auto-generated - do not edit
// WASM binary embedded as base64, compiled synchronously on first use

import * as commp_bg from './commp_bg.js';

const wasmBase64 = "${wasmBase64}";

// Decode base64 to Uint8Array, fastest available method first
function base64ToBytes(base64) {
  if (typeof Uint8Array.fromBase64 === 'function') {
    return Uint8Array.fromBase64(base64);
  }
  if (typeof globalThis.Buffer === 'function') {
    return globalThis.Buffer.from(base64, 'base64');
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compile and instantiate the WASM module, returning its exports.
 *
 * Throws if WebAssembly compilation is blocked, e.g. by a
 * Content-Security-Policy without 'wasm-unsafe-eval'.
 */
export function load() {
  let wasmModule;
  try {
    wasmModule = new WebAssembly.Module(base64ToBytes(wasmBase64));
  } catch (cause) {
    throw new Error(
      "@hugomrdias/commp-wasm: failed to compile WebAssembly. If a Content-Security-Policy is set, script-src must allow 'wasm-unsafe-eval'.",
      { cause }
    );
  }
  const importObject = { './commp_bg.js': commp_bg };
  return new WebAssembly.Instance(wasmModule, importObject).exports;
}
`

writeFileSync(join(outDir, 'commp_bg.wasm.js'), wasmLoaderContent)
console.log(`Created: ${join(outDir, 'commp_bg.wasm.js')}`)

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

writeFileSync(join(outDir, 'commp_bg.js'), modifiedBgJs)
console.log(`Created: ${join(outDir, 'commp_bg.js')}`)

// Create the main entry point
const mainContent = `// Auto-generated - do not edit
// CommP WASM with inline base64 encoding

import { load } from "./commp_bg.wasm.js";
export * from "./commp_bg.js";
import { __wbg_set_wasm } from "./commp_bg.js";

let wasm;

/**
 * Compile the WASM module on first call and return its exports.
 */
export function init() {
  if (wasm === undefined) {
    const exports = load();
    __wbg_set_wasm(exports);
    // Run wasm start function if present
    if (exports.__wbindgen_start) {
      exports.__wbindgen_start();
    }
    wasm = exports;
  }
  return wasm;
}

// Compile on first use instead of at import. The first access through this
// proxy swaps in the real exports, so later calls skip the proxy entirely.
__wbg_set_wasm(new Proxy({}, { get: (_, key) => init()[key] }));
`

writeFileSync(join(outDir, 'commp.js'), mainContent)
console.log(`Created: ${join(outDir, 'commp.js')}`)

// Types for the entry point, so TypeScript skips the untyped glue code
writeFileSync(
  join(outDir, 'commp.d.ts'),
  `${readFileSync(join(pkgDir, 'commp.d.ts'), 'utf-8')}
/**
 * Compile the WASM module on first call and return its exports.
 */
export function init(): WebAssembly.Exports;
`
)
console.log(`Created: ${join(outDir, 'commp.d.ts')}`)

console.log('\n✅ Done! Inline WASM module created at:', outDir)
