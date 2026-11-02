import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { faceEngine, findFaces, frameOf, hasFaceModel } from '../src/faces.ts'

describe('faces in the helper', () => {
  it('carries the expected model and runs it with the WebAssembly engine where onnxruntime-node is not installed', async () => {
    expect(await hasFaceModel()).toBe(true)
    expect(await hasFaceModel('/nowhere')).toBe(false)
    const engine = await faceEngine()
    expect(engine?.name).toBe('onnxruntime-web')
    // A plain picture: the model runs (14 times) and finds nobody.
    const preview = await sharp({ create: { width: 1024, height: 683, channels: 3, background: '#6a8' } }).webp().toBuffer()
    expect(await findFaces(preview, engine!)).toEqual([])
    expect(await frameOf(preview)).toBe(`1024x683:${preview.byteLength}`)
  })
})
