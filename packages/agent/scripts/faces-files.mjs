// The face detector's files beside dist/agent.mjs (src/faces.ts): the model, and onnxruntime-web's WebAssembly engine
// for helpers without onnxruntime-node (the desktop package). The Docker image takes the model only (Dockerfile).
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const out = new URL('../dist/faces/', import.meta.url)
mkdirSync(out, { recursive: true })
copyFileSync(new URL('../faces/blaze_face_full_range.onnx', import.meta.url), new URL('blaze_face_full_range.onnx', out))
// The package's Node entry is in its dist/ folder, beside the WebAssembly files.
const ort = dirname(createRequire(import.meta.url).resolve('onnxruntime-web'))
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) copyFileSync(join(ort, f), new URL(f, out))
console.log('dist/faces ready')
