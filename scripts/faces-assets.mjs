#!/usr/bin/env node
/**
 * The browser's face finder, added to the built site only for installs with faces (FACES=1, plans/PLAN-FN2-v2.md §14;
 * called by scripts/optional-bindings.mjs after `astro build`). Into dist/client/faces/: the worker (src/faces/worker.ts,
 * bundled), onnxruntime-web's plain WebAssembly build (never the WebGPU one: over the 25 MiB static file limit) and the
 * model; and into _headers, a strict policy for them alone. Static files skip the Worker's own security headers, and a
 * worker runs under its own script's policy, so this is what lets WebAssembly run there and nowhere else.
 */
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const OUT = 'dist/client/faces'
const HEADERS = 'dist/client/_headers'
const LIMIT = 25 * 1024 * 1024
const BLOCK = `/faces/*
  Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'
  X-Content-Type-Options: nosniff
  Cache-Control: public, max-age=3600
`

export async function facesAssets(include) {
  rmSync(OUT, { recursive: true, force: true })
  let headers = ''
  try {
    headers = readFileSync(HEADERS, 'utf8')
  } catch {
    // none yet
  }
  headers = headers.replace(/\n?\/faces\/\*\n(?: {2}.*\n?)*/g, '\n').replace(/\n{3,}/g, '\n\n')
  if (!include) {
    writeFileSync(HEADERS, headers)
    return
  }
  mkdirSync(OUT, { recursive: true })
  await build({ entryPoints: ['src/faces/worker.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, outfile: join(OUT, 'worker.js'), logLevel: 'warning' })
  const ort = dirname(createRequire(import.meta.url).resolve('onnxruntime-web'))
  for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) copyFileSync(join(ort, f), join(OUT, f))
  copyFileSync('packages/agent/faces/blaze_face_full_range.onnx', join(OUT, 'blaze_face_full_range.onnx'))
  for (const f of ['worker.js', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs', 'blaze_face_full_range.onnx']) {
    if (statSync(join(OUT, f)).size > LIMIT) throw new Error(`faces: ${f} is over the 25 MiB static file limit`)
  }
  writeFileSync(HEADERS, `${headers.trimEnd()}\n\n${BLOCK}`)
}
