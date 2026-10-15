// Auto-generated - do not edit
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
