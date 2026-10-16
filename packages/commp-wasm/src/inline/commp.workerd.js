// Auto-generated - do not edit
// CommP WASM for workerd (Cloudflare Workers)
//
// workerd only compiles WebAssembly from bytes during startup, so the inline
// base64 fails when this module is evaluated later (dynamic import, vitest).
// Wrangler compiles an imported .wasm file ahead of time instead.

import wasmModule from "./commp_bg.wasm";
import * as commp_bg from "./commp_bg.js";
export * from "./commp_bg.js";

const importObject = { "./commp_bg.js": commp_bg };
const wasm = new WebAssembly.Instance(wasmModule, importObject).exports;
commp_bg.__wbg_set_wasm(wasm);
// Run wasm start function if present
if (wasm.__wbindgen_start) {
  wasm.__wbindgen_start();
}

export { wasm };
