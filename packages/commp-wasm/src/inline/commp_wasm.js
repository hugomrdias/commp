// Auto-generated - do not edit
// CommP WASM with inline base64 encoding

import { wasm } from "./commp_wasm_bg.wasm.js";
export * from "./commp_wasm_bg.js";
import { __wbg_set_wasm } from "./commp_wasm_bg.js";

__wbg_set_wasm(wasm);

// Run wasm start function if present
if (wasm.__wbindgen_start) {
  wasm.__wbindgen_start();
}
