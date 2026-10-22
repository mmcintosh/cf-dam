/**
 * Rotate, mirror and crop without touching the original (catalog/edits.ts), the editor's crop box
 * (src/lib/crop.ts), and downloading a copy in a chosen size.
 */
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { drag, fitRatio, mirror, turnAnticlockwise, turnClockwise } from '../../../src/lib/crop'
import { baseKey, editedSize, parseEdit } from '../src/catalog/edits'
import { hashFromThumbnail } from '../src/catalog/phash'
import { renditionKey, storeClientRendition, webpSize } from '../src/catalog/renditions'
import { createHarness, createUser, cookiesFrom, json, setUpAdmin, signIn, type Harness } from './harness'
import { sharpImages } from './sharp-images'

let h: Harness
afterEach(async () => h?.dispose())

/** 1200 × 800: red on the left half, blue on the right, so a turn or a mirror shows where things went. */
async function halves(): Promise<Uint8Array<ArrayBuffer>> {
  const red = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#ff0000' } }).png().toBuffer()
  const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#0000ff' } })
    .composite([{ input: red, left: 0, top: 0 }])
    .png()
    .toBuffer()
  return new Uint8Array(png)
}

async function upload(admin: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const res = await h.fetch('/api/uploads', { ...json({ filename: 'halves.png', size: bytes.byteLength, allowDuplicate: true }), cookie: admin })
  const { uploadId } = (await res.json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${uploadId}/parts/1`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

const dims = (id: string, name: string) =>
  h.env.DB.prepare('SELECT width, height FROM renditions WHERE asset_id = ? AND name = ?').bind(id, name).first<{ width: number; height: number }>()

async function stored(key: string): Promise<Buffer | null> {
  const object = await h.env.MEDIA_BUCKET!.get(key)
  return object ? Buffer.from(await object.arrayBuffer()) : null
}

/** The colour at the middle of an image: 'red', 'blue' or what it is. */
async function middle(bytes: Buffer | Uint8Array): Promise<string> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
  const at = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels
  const [r, g, b] = [data[at]!, data[at + 1]!, data[at + 2]!]
  return r > 200 && b < 60 ? 'red' : b > 200 && r < 60 ? 'blue' : `rgb(${r},${g},${b})`
}

const edit = (id: string, admin: string, value: unknown) => h.fetch(`/api/assets/${id}/edit`, { method: 'PUT', body: JSON.stringify({ edit: value }), cookie: admin })

describe('rotate and crop', () => {
  it('turns and crops the thumbnail and preview, keeps the unedited ones, and undoes it all', async () => {
    h = await createHarness({ IMAGES: sharpImages() })
    const admin = await setUpAdmin(h)
    const id = await upload(admin, await halves())
    expect(await dims(id, 'preview')).toEqual({ width: 1200, height: 800 })

    // A quarter turn clockwise puts the red half on top; the bottom half of that is blue.
    const res = await edit(id, admin, { rotate: 90, mirror: false, crop: { x: 0, y: 0.5, width: 1, height: 0.5 } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ displayWidth: 800, displayHeight: 600, edit: { rotate: 90, mirror: false, crop: { x: 0, y: 0.5, width: 1, height: 0.5 } } })
    expect(await dims(id, 'preview')).toEqual({ width: 800, height: 600 })
    expect(await dims(id, 'thumb')).toEqual({ width: 320, height: 240 })
    expect(await middle((await stored(renditionKey(id, 'preview')))!)).toBe('blue')

    // The unedited preview is kept, and served for drawing the next edit.
    const base = await h.fetch(`/api/assets/${id}/renditions/preview?base=1`, { cookie: admin })
    expect(webpSize(new Uint8Array(await base.arrayBuffer()))).toEqual({ width: 1200, height: 800 })
    expect(base.headers.get('Cache-Control')).toBe('private, no-store')

    const asset = (await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as { displayWidth: number; displayHeight: number; width: number; imageVersion: string }
    expect(asset).toMatchObject({ width: 1200, displayWidth: 800, displayHeight: 600 })
    expect(asset.imageVersion).not.toBe('0')

    // A second edit starts again from the unedited picture: mirrored, the left half is blue.
    await edit(id, admin, { rotate: 0, mirror: true, crop: { x: 0, y: 0, width: 0.5, height: 1 } })
    expect(await dims(id, 'preview')).toEqual({ width: 600, height: 800 })
    expect(await middle((await stored(renditionKey(id, 'preview')))!)).toBe('blue')

    // Undone: the pictures come back and the kept ones go.
    expect((await edit(id, admin, null)).status).toBe(200)
    expect(await dims(id, 'preview')).toEqual({ width: 1200, height: 800 })
    expect(await dims(id, 'thumb')).toEqual({ width: 480, height: 320 })
    expect(await stored(baseKey(id, 'preview'))).toBeNull()
    expect(await stored(baseKey(id, 'thumb'))).toBeNull()
    const row = await h.env.DB.prepare('SELECT edit FROM assets WHERE id = ?').bind(id).first<{ edit: string | null }>()
    expect(row!.edit).toBeNull()
  })

  it('edits previews that arrive later too, and finds look-alikes on the unedited picture', async () => {
    h = await createHarness({ IMAGES: sharpImages() })
    const admin = await setUpAdmin(h)
    const id = await upload(admin, await halves())
    const before = await hashFromThumbnail(h.env, id)
    await edit(id, admin, { rotate: 180, mirror: false, crop: { x: 0.25, y: 0, width: 0.5, height: 1 } })
    expect(await hashFromThumbnail(h.env, id)).toBe(before)

    // A new preview (made again, or sent by an agent after the file changed) is edited on arrival.
    const fresh = await sharp(await halves()).webp().toBuffer()
    await storeClientRendition(h.env, id, 'preview', new Uint8Array(fresh).buffer)
    expect(await dims(id, 'preview')).toEqual({ width: 600, height: 800 })
    expect(webpSize(new Uint8Array((await stored(baseKey(id, 'preview')))!))).toEqual({ width: 1200, height: 800 })
  })

  it('refuses nonsense, videos and people who can only look; a do-nothing edit is no edit', async () => {
    h = await createHarness({ IMAGES: sharpImages() })
    const admin = await setUpAdmin(h)
    const id = await upload(admin, await halves())
    expect((await edit(id, admin, { rotate: 45 })).status).toBe(400)
    expect((await edit(id, admin, { crop: { x: 0.6, y: 0, width: 0.6, height: 1 } })).status).toBe(400)
    expect((await edit(id, admin, { crop: { x: 0, y: 0, width: 0.001, height: 1 } })).status).toBe(400)
    expect((await edit(id, admin, { rotate: 0, mirror: false, crop: { x: 0, y: 0, width: 1, height: 1 } })).status).toBe(200)
    expect((await h.env.DB.prepare('SELECT edit FROM assets WHERE id = ?').bind(id).first<{ edit: string | null }>())!.edit).toBeNull()

    await createUser(h, admin, { name: 'V', email: 'v@example.com', password: 'viewer password 1', roles: ['viewer'] })
    const viewer = cookiesFrom(await signIn(h, 'v@example.com', 'viewer password 1'))
    expect((await edit(id, viewer, { rotate: 90 })).status).toBe(403)

    await h.env.DB.prepare("UPDATE assets SET mime_type = 'video/mp4' WHERE id = ?").bind(id).run()
    expect((await edit(id, admin, { rotate: 90 })).status).toBe(409)
  })

  it('downloads a copy: small and large from the preview, full size from the original, edited as shown', async () => {
    h = await createHarness({ IMAGES: sharpImages() })
    const admin = await setUpAdmin(h)
    const id = await upload(admin, await halves())
    expect(await (await h.fetch(`/api/assets/${id}/download`, { cookie: admin })).json()).toEqual({ sizes: ['small', 'large', 'full', 'cutout'], watermark: false })

    const size = async (path: string) => {
      const res = await h.fetch(path, { cookie: admin })
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/jpeg')
      const bytes = Buffer.from(await res.arrayBuffer())
      const meta = await sharp(bytes).metadata()
      return { width: meta.width, height: meta.height, name: res.headers.get('Content-Disposition'), colour: await middle(bytes) }
    }
    expect(await size(`/api/assets/${id}/download/full`)).toMatchObject({ width: 1200, height: 800 })

    await edit(id, admin, { rotate: 270, mirror: false, crop: { x: 0, y: 0, width: 1, height: 0.5 } })
    // A quarter turn anticlockwise puts the blue half on top.
    expect(await size(`/api/assets/${id}/download/full`)).toMatchObject({ width: 800, height: 600, colour: 'blue' })
    const small = await size(`/api/assets/${id}/download/small`)
    expect(small).toMatchObject({ width: 800, height: 600, colour: 'blue' })
    expect(small.name).toContain('halves-small.jpg')
    expect((await h.fetch(`/api/assets/${id}/download/huge`, { cookie: admin })).status).toBe(409)
    // The cut-out is a PNG (the stand-in for Images ignores the background removal itself).
    const cutout = await h.fetch(`/api/assets/${id}/download/cutout`, { cookie: admin })
    expect(cutout.headers.get('Content-Type')).toBe('image/png')
    expect(cutout.headers.get('Content-Disposition')).toContain('halves-cutout.png')
    expect((await sharp(Buffer.from(await cutout.arrayBuffer())).metadata()).format).toBe('png')

    // An original the Worker can't read (on a NAS, say) offers the preview sizes only.
    await h.env.DB.prepare("UPDATE asset_locations SET storage_class = 'NAS' WHERE asset_id = ?").bind(id).run()
    expect(((await (await h.fetch(`/api/assets/${id}/download`, { cookie: admin })).json()) as { sizes: string[] }).sizes).toEqual(['small', 'large', 'cutout'])
    expect((await h.fetch(`/api/assets/${id}/download/full`, { cookie: admin })).status).toBe(409)
  })
})

describe('the edit itself', () => {
  it('checks and tidies what the page sends, and knows the edited size', () => {
    expect(parseEdit(null)).toBeNull()
    expect(parseEdit({ rotate: 0 })).toBeNull()
    expect(parseEdit({ rotate: 90, crop: { x: 0, y: 0, width: 1, height: 1 } })).toEqual({ rotate: 90, mirror: false, crop: null })
    expect(() => parseEdit({ rotate: 90, mirror: 'yes' })).toThrow('mirror')
    expect(() => parseEdit({ crop: { x: 0, y: 0, width: 1 } })).toThrow('crop')
    expect(editedSize(6000, 4000, { rotate: 90, mirror: true, crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.25 } })).toEqual({ width: 2000, height: 1500 })
  })
})

describe('the crop box', () => {
  const frame = { width: 3000, height: 2000 }
  const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }

  it('follows the picture when it turns or mirrors', () => {
    const turned = turnClockwise(box)
    expect(turned.x).toBeCloseTo(0.4)
    expect(turned).toMatchObject({ y: 0.1, width: 0.4, height: 0.3 })
    const back = turnAnticlockwise(turned)
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(back[k]).toBeCloseTo(box[k])
    expect(mirror(box).x).toBeCloseTo(0.6)
  })

  it('fits a shape around the crop, and keeps it while a corner is dragged', () => {
    const square = fitRatio(frame, 1)
    expect(square.width * frame.width).toBeCloseTo(square.height * frame.height)
    expect(square.height).toBe(1)
    expect(square.x).toBeCloseTo((1 - 2000 / 3000) / 2)

    // The south-east corner dragged right: the north-west one stays, and the shape holds.
    const dragged = drag({ x: 0, y: 0, width: 0.2, height: 0.3 }, 'se', 0.1, 0, frame, 1)
    expect(dragged).toMatchObject({ x: 0, y: 0 })
    expect(dragged.width * frame.width).toBeCloseTo(dragged.height * frame.height)
    expect(dragged.width).toBeCloseTo(0.3)
    // Never out of the picture.
    const moved = drag(box, 'move', 2, -2, frame, null)
    expect(moved).toMatchObject({ y: 0, width: 0.3, height: 0.4 })
    expect(moved.x).toBeCloseTo(0.7)
  })
})
