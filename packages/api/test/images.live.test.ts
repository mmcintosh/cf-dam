/**
 * Watermarks against real Cloudflare Images (the local emulator ignores draw()). Opt-in, a few
 * transforms on the logged-in account: IMAGES_LIVE=1 npx vitest run test/images.live.test.ts
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { DamBindings } from '../src/env'
import { migrate } from '../src/db/migrate'
import { editImage } from '../src/catalog/edits'
import { galleryImage, setWatermarkImage, updateWatermark, type WatermarkPosition } from '../src/catalog/watermark'

const ASSET = 'a'.repeat(32)

/** The colour at (x, y) of an encoded image, as [r, g, b]. */
async function pixel(bytes: ArrayBuffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(Buffer.from(bytes)).raw().toBuffer({ resolveWithObject: true })
  const at = (Math.round(y * (info.height - 1)) * info.width + Math.round(x * (info.width - 1))) * info.channels
  return [...data.subarray(at, at + 3)]
}
const isRed = ([r, g, b]: number[]) => r! > 200 && g! < 60 && b! < 60
const isBlue = ([r, g, b]: number[]) => b! > 200 && r! < 60 && g! < 60

describe.skipIf(!process.env.IMAGES_LIVE)('watermarks on real Images', () => {
  it('draws the watermark where the settings say, on views and JPEG downloads', async () => {
    const proxy = await getPlatformProxy<{ DB: D1Database; MEDIA_BUCKET: R2Bucket; IMAGES: ImagesBinding }>({
      configPath: 'test/wrangler.images.jsonc',
      persist: false,
      envFiles: [],
    })
    try {
      const env: DamBindings = { DB: proxy.env.DB, MEDIA_BUCKET: proxy.env.MEDIA_BUCKET, IMAGES: proxy.env.IMAGES }
      await migrate(env.DB)
      // A blue 1200×800 "preview" and an opaque red watermark.
      const preview = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 0, g: 0, b: 255 } } }).webp().toBuffer()
      await env.MEDIA_BUCKET!.put(`renditions/${ASSET}/preview.webp`, preview)
      const now = new Date().toISOString()
      await env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) VALUES (?, 'blue.jpg', 'image/jpeg', 1, 'ready', ?, ?)").bind(ASSET, now, now).run()
      await env.DB.prepare(
        "INSERT INTO renditions (asset_id, name, key, mime_type, width, height, size, source, created_at) VALUES (?, 'preview', ?, 'image/webp', 1200, 800, ?, 'worker', ?)",
      ).bind(ASSET, `renditions/${ASSET}/preview.webp`, preview.byteLength, now).run()
      const red = await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()
      await setWatermarkImage(env, new Uint8Array(red).buffer)

      const check = async (position: WatermarkPosition, expectations: [number, number, 'red' | 'blue'][], what: 'preview' | 'large' = 'preview') => {
        await updateWatermark(env, { position, scale: 0.25, opacity: 1 })
        const image = await galleryImage(env, ASSET, what, { watermark: true, longEdge: 2048 })
        const bytes = await new Response(image!.body).arrayBuffer()
        for (const [x, y, colour] of expectations) {
          const seen = await pixel(bytes, x, y)
          expect(colour === 'red' ? isRed(seen) : isBlue(seen), `${position} ${what} at ${x},${y}: ${seen}`).toBe(true)
        }
      }
      await check('center', [[0.5, 0.5, 'red'], [0.02, 0.02, 'blue'], [0.98, 0.98, 'blue']])
      await check('bottom-right', [[0.9, 0.93, 'red'], [0.5, 0.5, 'blue']])
      await check('bottom-left', [[0.1, 0.93, 'red'], [0.5, 0.5, 'blue']], 'large')
      await check('tiled', [[0.05, 0.05, 'red'], [0.5, 0.5, 'red']])
    } finally {
      await proxy.dispose()
    }
  }, 120_000)
})

describe.skipIf(!process.env.IMAGES_LIVE)('edits on real Images', () => {
  it('turns clockwise, mirrors left to right, crops after both, and reads EXIF orientation as previews do', async () => {
    const proxy = await getPlatformProxy<{ IMAGES: ImagesBinding }>({ configPath: 'test/wrangler.images.jsonc', persist: false, envFiles: [] })
    try {
      const images = proxy.env.IMAGES
      // Red on the left half, blue on the right.
      const red = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer()
      const halves = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 0, g: 0, b: 255 } } })
        .composite([{ input: red, left: 0, top: 0 }])
        .png()
        .toBuffer()
      const run = async (input: Buffer, edit: Parameters<typeof editImage>[3], size = { width: 1200, height: 800 }) => {
        const { image } = editImage(images, new Blob([new Uint8Array(input)]).stream(), size, edit)
        const bytes = await (await image.output({ format: 'image/png' })).response().arrayBuffer()
        const meta = await sharp(Buffer.from(bytes)).metadata()
        return { bytes, width: meta.width, height: meta.height }
      }
      const turned = await run(halves, { rotate: 90, mirror: false, crop: null })
      expect([turned.width, turned.height]).toEqual([800, 1200])
      expect(isRed(await pixel(turned.bytes, 0.5, 0.1)), 'clockwise puts the left half on top').toBe(true)
      const mirrored = await run(halves, { rotate: 0, mirror: true, crop: null })
      expect(isBlue(await pixel(mirrored.bytes, 0.1, 0.5)), 'mirrored, blue is on the left').toBe(true)
      const cropped = await run(halves, { rotate: 90, mirror: false, crop: { x: 0, y: 0.5, width: 1, height: 0.5 } })
      expect([cropped.width, cropped.height]).toEqual([800, 600])
      expect(isBlue(await pixel(cropped.bytes, 0.5, 0.5)), 'the crop is drawn on the turned picture').toBe(true)

      // A camera JPEG stored on its side (EXIF orientation 6): previews show it upright.
      const sideways = await sharp(halves).jpeg().withMetadata({ orientation: 6 }).toBuffer()
      const info = await images.info(new Blob([new Uint8Array(sideways)]).stream())
      const upright = await run(sideways, { rotate: 0, mirror: false, crop: null })
      expect({ info: 'width' in info ? [info.width, info.height] : null, output: [upright.width, upright.height] }).toEqual({ info: [800, 1200], output: [800, 1200] })
    } finally {
      await proxy.dispose()
    }
  }, 120_000)
})
