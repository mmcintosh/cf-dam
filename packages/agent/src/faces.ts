/**
 * Finding faces in the helper (cf-dam-docs plans/PLAN-FN2-v2.md): on the preview it has just made, and on older photos
 * cf-dam asks about, only while cf-dam says Find faces is on. The detector is shared with the browser
 * (@cf-dam/api/face-detect); the engine is onnxruntime-node where it's installed (the Docker image, pruned to its
 * platform) and onnxruntime-web's WebAssembly build otherwise (the desktop helper). Either is loaded only when faces are
 * first needed. Only boxes go to cf-dam: no facial points, no crops.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectFaces, FACE_INPUT, FACE_MODEL, FACE_MODEL_SHA256, type DetectedFace, type FaceInfer } from '@cf-dam/api/face-detect'
import sharp from 'sharp'

export { FACE_MODEL }

/** Where the model and the WebAssembly engine are: FACES_DIR, or faces/ beside agent.mjs (or beside src/, running from source). */
export function facesDir(): string {
  if (process.env.FACES_DIR) return process.env.FACES_DIR
  const here = dirname(fileURLToPath(import.meta.url))
  return [join(here, 'faces'), join(here, '..', 'faces')].find((d) => existsSync(join(d, 'blaze_face_full_range.onnx'))) ?? join(here, 'faces')
}

type Engine = { infer: FaceInfer; name: 'onnxruntime-node' | 'onnxruntime-web' }

let loading: Promise<Engine | null> | null = null

/** Whether this helper carries the model cf-dam expects (read once; the engine itself loads only when needed). */
export async function hasFaceModel(dir = facesDir()): Promise<boolean> {
  try {
    return createHash('sha256').update(await readFile(join(dir, 'blaze_face_full_range.onnx'))).digest('hex') === FACE_MODEL_SHA256
  } catch {
    return false
  }
}

/** The engine, or null when this helper can't find faces (no model file, or it isn't the one cf-dam expects). */
export function faceEngine(dir = facesDir()): Promise<Engine | null> {
  return (loading ??= load(dir))
}

async function load(dir: string): Promise<Engine | null> {
  let model: Buffer
  try {
    model = await readFile(join(dir, 'blaze_face_full_range.onnx'))
  } catch {
    return null
  }
  if (createHash('sha256').update(model).digest('hex') !== FACE_MODEL_SHA256) {
    console.warn('[faces] the model file is not the expected one; not finding faces')
    return null
  }
  const shape = [1, FACE_INPUT, FACE_INPUT, 3]
  // onnxruntime-node sends usage events to Microsoft unless told not to (read when it starts): never.
  process.env.ORT_DISABLE_TELEMETRY = '1'
  try {
    // Installed in the Docker image only (an optional dependency elsewhere would download every platform's build).
    const ort = (await import(/* @vite-ignore */ 'onnxruntime-node' as string)) as typeof import('onnxruntime-web')
    const session = await ort.InferenceSession.create(model, { intraOpNumThreads: 1, interOpNumThreads: 1 })
    return { name: 'onnxruntime-node', infer: run(ort, session, shape) }
  } catch {
    try {
      const ort = await import('onnxruntime-web')
      ort.env.wasm.numThreads = 1
      // Shipped beside the model; running from source, onnxruntime-web finds its own.
      if (existsSync(join(dir, 'ort-wasm-simd-threaded.wasm'))) ort.env.wasm.wasmPaths = `${dir}/`
      const session = await ort.InferenceSession.create(model)
      return { name: 'onnxruntime-web', infer: run(ort, session, shape) }
    } catch (error) {
      console.warn('[faces] no engine could load the model; not finding faces', error)
      return null
    }
  }
}

function run(ort: typeof import('onnxruntime-web'), session: import('onnxruntime-web').InferenceSession, shape: number[]): FaceInfer {
  return async (input) => {
    const out = await session.run({ [session.inputNames[0]!]: new ort.Tensor('float32', input, shape) })
    return [out[session.outputNames[0]!]!.data as Float32Array, out[session.outputNames[1]!]!.data as Float32Array]
  }
}

/** The faces on a preview (WebP bytes, upright as made), in per-mille of it. */
export async function findFaces(preview: Buffer, engine: Engine): Promise<DetectedFace[]> {
  const { data, info } = await sharp(preview).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return detectFaces(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height, engine.infer)
}

/** "width x height : bytes" of a preview, as cf-dam names the picture the boxes belong to. */
export async function frameOf(preview: Buffer): Promise<string> {
  const { width, height } = await sharp(preview).metadata()
  return `${width}x${height}:${preview.byteLength}`
}
