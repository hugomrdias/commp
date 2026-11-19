/**
 * Streaming CommP hasher with O(log n) memory
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
     * Get bytes written count
     * @returns {bigint}
     */
    count() {
        const ret = wasm.commphasher_count(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Get the full multihash-encoded digest
     *
     * Returns: [code (varint 0x1011), size (varint), padding (varint), height (u8), root (32 bytes)]
     *
     * - `code`: 0x1011 = "fr32-sha256-trunc254-padded-binary-tree" multihash identifier
     * - `size`: total digest size (padding_len + 1 + 32)
     * - `padding`: bytes of zero-padding added to reach next power-of-two piece size
     * - `height`: tree height (log2 of piece size / 32)
     * - `root`: 32-byte Merkle root
     * @returns {Uint8Array}
     */
    digest() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
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
    /**
     * Create a new hasher
     */
    constructor() {
        const ret = wasm.commphasher_new();
        this.__wbg_ptr = ret;
        CommPHasherFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Reset the hasher for reuse
     */
    reset() {
        wasm.commphasher_reset(this.__wbg_ptr);
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
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
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
     * Write bytes into the hasher
     *
     * Throws a `RangeError` (without changing the hasher) if the total would
     * exceed `MAX_PAYLOAD_SIZE`.
     * @param {Uint8Array | number[]} bytes
     */
    write(bytes) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.commphasher_write(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeFromExternrefTable0(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
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
 * @param {Uint8Array | number[]} data
 * @returns {Uint8Array}
 */
export function digest(data) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.digest(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeFromExternrefTable0(r2);
        }
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
 * @param {Uint8Array | number[]} data
 * @returns {Uint8Array}
 */
export function root(data) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16) >>> 0;
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.root(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeFromExternrefTable0(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
export function __wbg___wbindgen_throw_4c88d8bf264fd984(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
}
export function __wbg_new_5bc796c3be6c17e4(arg0, arg1) {
    const ret = new RangeError(getStringFromWasm0(arg0, arg1));
    return ret;
}
export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    table.set(0, undefined);
    table.set(1024, undefined);
    table.set(1025, null);
    table.set(1026, true);
    table.set(1027, false);
}
const CommPHasherFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_commphasher_free(ptr, 1));

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
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
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

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__wbindgen_export3(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

let WASM_VECTOR_LEN = 0;


let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}
