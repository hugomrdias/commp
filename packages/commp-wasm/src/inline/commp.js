// Auto-generated - do not edit
// CommP WASM with inline base64 encoding

import { load } from "./commp_bg.wasm.js";
export * from "./commp_bg.js";
import { __wbg_set_wasm } from "./commp_bg.js";

/**
 * WASM exports, or undefined if compilation failed.
 */
let wasm;

try {
  const exports = load();
  __wbg_set_wasm(exports);
  // Run wasm start function if present
  if (exports.__wbindgen_start) {
    exports.__wbindgen_start();
  }
  wasm = exports;
} catch (error) {
  // Keep the import working (e.g. under a Content-Security-Policy without
  // 'wasm-unsafe-eval') and throw the compile error on first use instead.
  __wbg_set_wasm(
    new Proxy({}, {
      get() {
        throw error;
      },
    })
  );
}

export { wasm };
