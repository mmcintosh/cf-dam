import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findProblems } from '../src/catalog/alerts'
import { countedImages, imageUsage } from '../src/lib/images'
import { createHarness, setUpAdmin, type Harness } from './harness'

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

/** A stand-in for the Images binding: transform() chains, output() makes "an image", info() reads one. */
function fakeImages() {
  const transformer = {
    transform: () => transformer,
    draw: () => transformer,
    output: async () => ({ response: () => new Response('image') }),
  }
  return { input: () => transformer, info: async () => ({ width: 10, height: 10, format: 'image/webp', fileSize: 5 }) } as unknown as ImagesBinding
}

describe('image usage', () => {
  it('counts each image Images makes, not info(), and alerts past the threshold', async () => {
    const env = { ...h.env, IMAGES: fakeImages() }
    const images = countedImages(env)!
    await images.input(new Blob(['x']).stream()).transform({ width: 10 }).output({ format: 'image/webp' })
    await images.input(new Blob(['x']).stream()).output({ format: 'image/png' })
    await images.info(new Blob(['x']).stream())
    expect(await imageUsage(h.env.DB)).toMatchObject({ count: 2, alertAt: 4000 })

    expect((await findProblems(h.env.DB)).findings.map((f) => f.kind)).not.toContain('images.usage')
    const set = await h.fetch('/api/usage/images', { method: 'PUT', body: JSON.stringify({ alertAt: 2 }), cookie: admin })
    expect(await set.json()).toMatchObject({ images: { count: 2, alertAt: 2 } })
    expect((await findProblems(h.env.DB)).findings).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'images.usage', link: '/settings/storage' })]))

    // 0 turns the alert off; nonsense is refused.
    await h.fetch('/api/usage/images', { method: 'PUT', body: JSON.stringify({ alertAt: 0 }), cookie: admin })
    expect((await findProblems(h.env.DB)).findings.map((f) => f.kind)).not.toContain('images.usage')
    expect((await h.fetch('/api/usage/images', { method: 'PUT', body: JSON.stringify({ alertAt: -1 }), cookie: admin })).status).toBe(400)
  })
})
