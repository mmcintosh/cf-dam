/** The vision adapters against real Workers AI. Opt-in (costs cents): AI_LIVE=1 npx vitest run test/ai.live.test.ts */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { analyzeImage, VISION_MODELS } from '../src/catalog/vision'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

describe.skipIf(!process.env.AI_LIVE)('Workers AI vision, live', () => {
  for (const model of VISION_MODELS) {
    it(`${model.label} returns usable tags, alt text and a caption`, async () => {
      const proxy = await getPlatformProxy<{ AI: Ai; IMAGES: ImagesBinding }>({ configPath: 'test/wrangler.ai.jsonc', persist: false, envFiles: [] })
      try {
        const jpeg = await proxy.env.IMAGES.input(new Blob([camera]).stream()).transform({ width: 1024 }).output({ format: 'image/jpeg', quality: 82 })
        const bytes = new Uint8Array(await jpeg.response().arrayBuffer())
        let binary = ''
        for (const b of bytes) binary += String.fromCharCode(b)
        const started = Date.now()
        const result = await analyzeImage(proxy.env.AI, model.id, `data:image/jpeg;base64,${btoa(binary)}`, { filename: 'IMG_2041.jpg' })
        console.log(`\n${model.label} (${Date.now() - started} ms):`, JSON.stringify(result))
        expect(result.tags.length).toBeGreaterThanOrEqual(3)
        expect(result.alt.length).toBeGreaterThan(5)
        expect(result.caption.length).toBeGreaterThan(5)
      } finally {
        await proxy.dispose()
      }
    }, 120_000)
  }
})
