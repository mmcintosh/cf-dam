/**
 * The browser's face finder (plans/PLAN-FN2-v2.md, FN2b): a module Web Worker served from /faces/ with its own strict
 * security policy (`_headers`, written at deploy by scripts/faces-assets.mjs); the page's policy is unchanged and never
 * allows WebAssembly. onnxruntime-web runs only here, one thread, no proxy worker, everything from our own origin.
 * For each photo: the unedited preview, decoded, the shared detector (packages/api face-detect.ts), and only the boxes
 * back to the page. Built only when an install has faces (FACES=1).
 */
import * as ort from 'onnxruntime-web/wasm'
import { detectFaces, FACE_INPUT, type FaceInfer } from '../../packages/api/src/catalog/face-detect'

ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false
ort.env.wasm.wasmPaths = '/faces/'

let infer: Promise<FaceInfer> | null = null
function engine(): Promise<FaceInfer> {
  return (infer ??= ort.InferenceSession.create('/faces/blaze_face_full_range.onnx').then((session) => {
    const shape = [1, FACE_INPUT, FACE_INPUT, 3]
    return async (input: Float32Array) => {
      const out = await session.run({ [session.inputNames[0]!]: new ort.Tensor('float32', input, shape) })
      return [out[session.outputNames[0]!]!.data as Float32Array, out[session.outputNames[1]!]!.data as Float32Array] as [Float32Array, Float32Array]
    }
  }))
}

export type FaceJob = { assetId: string }
export type FaceAnswer =
  | { assetId: string; frame: string; faces: { x: number; y: number; w: number; h: number; score: number }[] }
  | { assetId: string; failed: true }

self.onmessage = async (event: MessageEvent<FaceJob>) => {
  const { assetId } = event.data
  try {
    const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}/renditions/preview?base=1`, { credentials: 'same-origin' })
    if (!res.ok) throw new Error(`preview ${res.status}`)
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    bitmap.close()
    const faces = await detectFaces(data, width, height, await engine())
    self.postMessage({ assetId, frame: `${width}x${height}:${blob.size}`, faces } satisfies FaceAnswer)
  } catch {
    self.postMessage({ assetId, failed: true } satisfies FaceAnswer)
  }
}
