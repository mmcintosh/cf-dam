import { describe, expect, it } from 'vitest'
import { decode, detectFaces, FACE_INPUT, suppress } from '../src/catalog/face-detect'

const ANCHORS = (FACE_INPUT / 4) ** 2

/** Raw model output with one confident face on the anchor at (col, row), every other value noise or keypoints. */
function output(col: number, row: number, w: number, h: number, keypoints = 999): [Float32Array, Float32Array] {
  const regressors = new Float32Array(ANCHORS * 16).fill(keypoints)
  const scores = new Float32Array(ANCHORS).fill(-10)
  const a = row * (FACE_INPUT / 4) + col
  regressors.set([0, 0, w, h], a * 16)
  scores[a] = 5
  return [regressors, scores]
}

describe('the face decoder', () => {
  it('reads a box from the first four numbers and never the six facial points', () => {
    const [reg, sc] = output(24, 24, 40, 48)
    const [boxA] = decode(reg, sc, { x: 0, y: 0, scale: 1, ox: 0, oy: 0 })
    const [reg2] = output(24, 24, 40, 48, -555)
    const [boxB] = decode(reg2, sc, { x: 0, y: 0, scale: 1, ox: 0, oy: 0 })
    expect(boxA).toEqual(boxB)
    expect(Object.keys(boxA!).sort()).toEqual(['h', 'score', 'w', 'x', 'y'])
    expect(boxA).toMatchObject({ x: 98 - 20, y: 98 - 24, w: 40, h: 48 })
  })

  it('keeps faces under the threshold out, merges overlapping boxes, and caps the count at 100', () => {
    const [reg, sc] = output(10, 10, 20, 20)
    sc[10 * 48 + 10] = 0.2 // sigmoid ≈ 0.55
    expect(decode(reg, sc, { x: 0, y: 0, scale: 1, ox: 0, oy: 0 })).toEqual([])
    const box = (x: number, score: number) => ({ x, y: 10, w: 20, h: 20, score })
    expect(suppress([box(10, 0.9), box(12, 0.8), box(100, 0.7)])).toHaveLength(2)
    expect(suppress(Array.from({ length: 150 }, (_, i) => box(i * 30, 0.9)))).toHaveLength(100)
  })

  it('gives per-mille boxes inside the picture, from every tile', async () => {
    const width = 400
    const height = 300
    const pixels = new Uint8Array(width * height * 4).fill(128)
    let runs = 0
    const faces = await detectFaces(pixels, width, height, async () => {
      runs++
      return output(24, 24, 40, 48)
    })
    expect(runs).toBe(1 + 4 + 9)
    expect(faces.length).toBeGreaterThan(0)
    for (const f of faces) {
      expect(f.x + f.w).toBeLessThanOrEqual(1000)
      expect(f.y + f.h).toBeLessThanOrEqual(1000)
      expect(Number.isInteger(f.x) && Number.isInteger(f.score)).toBe(true)
    }
  })
})
