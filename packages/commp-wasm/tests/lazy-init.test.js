/**
 * Lazy WASM compilation tests
 *
 * A Content-Security-Policy without 'wasm-unsafe-eval' makes WebAssembly
 * compilation throw. Importing must still work; only hashing should fail.
 * Each case runs in a fresh Node process so the module graph is not cached.
 */

import assert from 'node:assert'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, it } from 'mocha'

const run = promisify(execFile)
const entry = new URL('../src/index.js', import.meta.url).href

/**
 * Run `body` as an ES module after blocking WebAssembly compilation, the way a
 * strict Content-Security-Policy does
 *
 * @param {string} body
 */
async function runBlocked(body) {
  const script = `
    WebAssembly.Module = function () {
      throw new WebAssembly.CompileError('blocked by Content-Security-Policy')
    }
    const Commp = await import(${JSON.stringify(entry)})
    ${body}
  `
  const { stdout } = await run(process.execPath, [
    '--input-type=module',
    '--eval',
    script,
  ])
  return stdout.trim()
}

describe('lazy wasm compilation', () => {
  it('imports without compiling WebAssembly', async () => {
    const out = await runBlocked('console.log(typeof Commp.create, Commp.code)')
    assert.strictEqual(out, 'function 4113')
  })

  it('throws a CSP hint with the compile error as cause on first use', async () => {
    const out = await runBlocked(`
      for (const fn of [() => Commp.create(), () => Commp.root(new Uint8Array(127))]) {
        try {
          fn()
          console.log('no error')
        } catch (err) {
          console.log(JSON.stringify([err.message, err.cause?.name]))
        }
      }
    `)
    const hint =
      "@hugomrdias/commp-wasm: failed to compile WebAssembly. If a Content-Security-Policy is set, script-src must allow 'wasm-unsafe-eval'."
    assert.deepStrictEqual(
      out.split('\n').map((line) => JSON.parse(line)),
      [
        [hint, 'CompileError'],
        [hint, 'CompileError'],
      ]
    )
  })
})
