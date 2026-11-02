/**
 * Finding faces with BlazeFace full-range (MediaPipe, Apache-2.0), shared by the helper and the browser like dhash.ts:
 * no imports, so both bundle it as it is, and the same pixels give the same boxes everywhere (spike FN0,
 * cf-dam-docs research/SPIKE-FN0.md). The engine is passed in (`infer`): onnxruntime-node in the Docker helper,
 * onnxruntime-web elsewhere.
 *
 * In: RGBA pixels of the unedited, upright preview. Out: boxes in per-mille of it, with a score. The model computes six
 * facial points with each box; only the box's four numbers are ever read, so no points leave this file.
 *
 * Setting (FACE_MODEL in faces.ts): the whole picture plus 2×2 and 3×3 tiles overlapping by 20%, score ≥ 0.6, weighted
 * non-maximum suppression, at most 100 faces. It finds most faces down to about 3% of the long edge.
 */

/** The detector and its setting, recorded with every box: a new id makes cf-dam look at every photo again. */
export const FACE_MODEL = 'blazeface-fr-1/g23/t60'
/** packages/agent/faces/blaze_face_full_range.onnx (NOTICE): engines check the file before loading it. */
export const FACE_MODEL_SHA256 = 'ec936267f18d07717e412f45f7bcc4468b26ccd58735643aa65f4c1dde997eee'

/** Runs the model on one NHWC float32 tensor (192×192×3, −1…1): [regressors (2304×16), scores (2304)]. */
export type FaceInfer = (input: Float32Array) => Promise<[Float32Array, Float32Array]>

export interface DetectedFace {
  x: number
  y: number
  w: number
  h: number
  score: number
}

export const FACE_INPUT = 192
const GRIDS = [2, 3]
const OVERLAP = 0.2
const THRESHOLD = 0.6
const CAP = 100

let anchorCache: { x: number; y: number }[] | null = null
/** face_detection_full_range: one anchor per cell of a 48×48 grid. */
function anchors(): { x: number; y: number }[] {
  if (anchorCache) return anchorCache
  const cells = FACE_INPUT / 4
  const out: { x: number; y: number }[] = []
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) out.push({ x: (x + 0.5) / cells, y: (y + 0.5) / cells })
  return (anchorCache = out)
}

/**
 * The model's input for one region of the picture: letterboxed (the region keeps its shape, centred, black around it)
 * and resized by area average here rather than by a browser's or sharp's resampler, so every side gets the same numbers.
 */
function tensor(rgba: Uint8Array | Uint8ClampedArray, width: number, rx: number, ry: number, rw: number, rh: number) {
  const size = FACE_INPUT
  const scale = size / Math.max(rw, rh)
  const ox = (size - rw * scale) / 2
  const oy = (size - rh * scale) / 2
  const out = new Float32Array(size * size * 3).fill(-1)
  for (let ty = 0; ty < size; ty++) {
    const sy0 = ry + (ty - oy) / scale
    const sy1 = ry + (ty + 1 - oy) / scale
    if (sy1 <= ry || sy0 >= ry + rh) continue
    const y0 = Math.max(ry, Math.floor(sy0))
    const y1 = Math.min(ry + rh, Math.max(y0 + 1, Math.ceil(sy1)))
    for (let tx = 0; tx < size; tx++) {
      const sx0 = rx + (tx - ox) / scale
      const sx1 = rx + (tx + 1 - ox) / scale
      if (sx1 <= rx || sx0 >= rx + rw) continue
      const x0 = Math.max(rx, Math.floor(sx0))
      const x1 = Math.min(rx + rw, Math.max(x0 + 1, Math.ceil(sx1)))
      let r = 0
      let g = 0
      let b = 0
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4
          r += rgba[i]!
          g += rgba[i + 1]!
          b += rgba[i + 2]!
        }
      const n = (y1 - y0) * (x1 - x0)
      const o = (ty * size + tx) * 3
      out[o] = r / n / 127.5 - 1
      out[o + 1] = g / n / 127.5 - 1
      out[o + 2] = b / n / 127.5 - 1
    }
  }
  return { out, scale, ox, oy }
}

const intersection = (a: DetectedFace, b: DetectedFace) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/** MediaPipe's weighted non-maximum suppression; a face cut by a tile's edge also merges into the whole one. */
export function suppress(boxes: DetectedFace[]): DetectedFace[] {
  const left = [...boxes].sort((a, b) => b.score - a.score)
  const kept: DetectedFace[] = []
  while (left.length > 0 && kept.length < CAP) {
    const top = left[0]!
    const group = left.filter((b) => {
      const inter = intersection(top, b)
      return inter / (top.w * top.h + b.w * b.h - inter) > 0.3 || inter / Math.min(top.w * top.h, b.w * b.h) > 0.6
    })
    const total = group.reduce((s, b) => s + b.score, 0)
    const mean = (k: 'x' | 'y' | 'w' | 'h') => group.reduce((s, b) => s + b[k] * b.score, 0) / total
    kept.push({ x: mean('x'), y: mean('y'), w: mean('w'), h: mean('h'), score: top.score })
    for (const b of group) left.splice(left.indexOf(b), 1)
  }
  return kept
}

/**
 * Turn one run's raw output into boxes in the picture's pixels. Of each anchor's sixteen numbers only the first four
 * (the box) are read; the other twelve, the six facial points, are not.
 */
export function decode(regressors: Float32Array, scores: Float32Array, region: { x: number; y: number; scale: number; ox: number; oy: number }): DetectedFace[] {
  const list = anchors()
  const size = FACE_INPUT
  const found: DetectedFace[] = []
  for (let a = 0; a < list.length; a++) {
    const score = 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, scores[a]!))))
    if (score < THRESHOLD) continue
    const r = a * 16
    const cx = regressors[r]! + list[a]!.x * size
    const cy = regressors[r + 1]! + list[a]!.y * size
    const w = regressors[r + 2]!
    const h = regressors[r + 3]!
    found.push({ x: region.x + (cx - w / 2 - region.ox) / region.scale, y: region.y + (cy - h / 2 - region.oy) / region.scale, w: w / region.scale, h: h / region.scale, score })
  }
  return found
}

/** The faces in an RGBA picture, in per-mille of it, ready to send to cf-dam. */
export async function detectFaces(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, infer: FaceInfer): Promise<DetectedFace[]> {
  const regions: [number, number, number, number][] = [[0, 0, width, height]]
  for (const n of GRIDS) {
    const tw = width / (n - (n - 1) * OVERLAP)
    const th = height / (n - (n - 1) * OVERLAP)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = Math.round(i * tw * (1 - OVERLAP))
        const y = Math.round(j * th * (1 - OVERLAP))
        regions.push([x, y, Math.min(Math.round(tw), width - x), Math.min(Math.round(th), height - y)])
      }
  }
  const found: DetectedFace[] = []
  for (const [rx, ry, rw, rh] of regions) {
    const { out, scale, ox, oy } = tensor(rgba, width, rx, ry, rw, rh)
    const [regressors, scores] = await infer(out)
    found.push(...decode(regressors, scores, { x: rx, y: ry, scale, ox, oy }))
  }
  return suppress(found).flatMap((b) => {
    const x0 = Math.max(0, b.x)
    const y0 = Math.max(0, b.y)
    const x1 = Math.min(width, b.x + b.w)
    const y1 = Math.min(height, b.y + b.h)
    const box = {
      x: Math.min(999, Math.round((x0 / width) * 1000)),
      y: Math.min(999, Math.round((y0 / height) * 1000)),
      w: Math.round(((x1 - x0) / width) * 1000),
      h: Math.round(((y1 - y0) / height) * 1000),
      score: Math.round(b.score * 1000),
    }
    box.w = Math.min(box.w, 1000 - box.x)
    box.h = Math.min(box.h, 1000 - box.y)
    return box.w >= 1 && box.h >= 1 ? [box] : []
  })
}
