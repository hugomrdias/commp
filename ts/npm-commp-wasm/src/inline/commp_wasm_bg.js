let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

const CommPHasherFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_commphasher_free(ptr >>> 0, 1));

/**
 * Streaming CommP hasher with optimized memory management
 */
export class CommPHasher {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CommPHasherFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_commphasher_free(ptr, 0);
    }
    /**
     * Create a new hasher
     */
    constructor() {
        const ret = wasm.commphasher_new();
        this.__wbg_ptr = ret >>> 0;
        CommPHasherFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get just the 32-byte CommP root hash
     *
     * Returns the raw Merkle root without multihash encoding.
     * Use `digest()` if you need the full multihash with metadata.
     * @returns {Uint8Array}
     */
    root() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.commphasher_root(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get bytes written count
     * @returns {bigint}
     */
    count() {
        const ret = wasm.commphasher_count(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Reset the hasher for reuse
     */
    reset() {
        wasm.commphasher_reset(this.__wbg_ptr);
    }
    /**
     * Write bytes into the hasher
     * @param {Uint8Array} bytes
     */
    write(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.commphasher_write(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Get the full multihash-encoded digest
     *
     * Returns: [code (varint 0x1011), size (varint), padding (varint), height (u8), root (32 bytes)]
     *
     * - `code`: 0x1011 = "fr32-sha256-trunc254-padded-binary-tree" multihash identifier
     * - `size`: total digest size (padding_len + 1 + 32)
     * - `padding`: bytes of zero-padding added to reach next power-of-two piece size
     * - `height`: tree height (log2 of leaf count)
     * - `root`: 32-byte Merkle root
     * @returns {Uint8Array}
     */
    digest() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.commphasher_digest(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Get the tree height
     * @returns {number}
     */
    height() {
        const ret = wasm.commphasher_height(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) CommPHasher.prototype[Symbol.dispose] = CommPHasher.prototype.free;

/**
 * One-shot digest: returns full multihash-encoded CommP
 *
 * Format: [code (varint 0x1011), size (varint), padding (varint), height (u8), root (32 bytes)]
 *
 * Use this when you need the complete Filecoin piece commitment with metadata.
 * The multihash code 0x1011 identifies this as "fr32-sha256-trunc254-padded-binary-tree".
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function digest(data) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.digest(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * One-shot root: returns just the 32-byte CommP root hash
 *
 * Use this when you only need the raw hash without multihash encoding.
 * This is the Merkle root of the FR32-padded, SHA256-hashed binary tree.
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function root(data) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.root(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

export function __wbg___wbindgen_throw_dd24417ed36fc46e(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
};
