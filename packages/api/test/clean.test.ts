import { readFileSync } from 'node:fs'
import { crc32 } from 'node:zlib'
import exifr from 'exifr'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanExif, cleanOriginal, CleanError, webpWithoutMetadata, type Credit } from '../src/storage/clean'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
const privateJpeg = fixture('private.jpg')
const privatePng = fixture('private.png')
const credit: Credit = { creator: 'Test Photographer', copyright: '© 2024 Test Studio' }
const SECRETS = ['Lily', 'Grandma', 'Jo Owner', 'smith family']

const streamOf = (bytes: Uint8Array, chunk = 997) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      // Small, odd-sized chunks, so markers and chunk headers fall across chunk boundaries.
      for (let at = 0; at < bytes.length; at += chunk) controller.enqueue(bytes.slice(at, at + chunk))
      controller.close()
    },
  })
const bytesOf = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer())
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')
const endsWithEoi = (bytes: Uint8Array) => bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9

async function clean(bytes: Uint8Array, type = 'image/jpeg', who: Credit = credit) {
  const cleaned = await cleanOriginal(streamOf(bytes), type, bytes.length, who, type === 'image/jpeg' && endsWithEoi(bytes))
  const out = await bytesOf(cleaned.body)
  return { out, length: cleaned.length }
}

/** The decoded pixels, to show cleaning never touches the picture. */
const pixels = async (bytes: Uint8Array) => (await sharp(bytes).raw().toBuffer()).toString('base64')

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length)
  out.set([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff])
  out.set(payload, 4)
  return out
}
const join = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts))
const afterSoi = (jpeg: Uint8Array, ...inserted: Uint8Array[]) => join(jpeg.subarray(0, 2), ...inserted, jpeg.subarray(2))

/** An APP2 MPF segment for two pictures: the first `primary` bytes long from the file's start, the second after it. */
function mpfSegment(primary: number, second: number): Uint8Array {
  const tiff = Buffer.alloc(8 + 2 + 3 * 12 + 4 + 32)
  tiff.write('II', 0, 'latin1')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4)
  tiff.writeUInt16LE(3, 8)
  const entry = (k: number, tag: number, type: number, count: number, value: number | string) => {
    const at = 10 + k * 12
    tiff.writeUInt16LE(tag, at)
    tiff.writeUInt16LE(type, at + 2)
    tiff.writeUInt32LE(count, at + 4)
    if (typeof value === 'string') tiff.write(value, at + 8, 'latin1')
    else tiff.writeUInt32LE(value, at + 8)
  }
  entry(0, 0xb000, 7, 4, '0100')
  entry(1, 0xb001, 4, 1, 2)
  entry(2, 0xb002, 7, 32, 50)
  // The second picture's offset counts from this TIFF header: SOI (2) + marker and length (4) + "MPF\0" (4) = 10.
  const data = 50
  tiff.writeUInt32LE(0x20030000, data)
  tiff.writeUInt32LE(primary, data + 4)
  tiff.writeUInt32LE(0, data + 8)
  tiff.writeUInt32LE(0, data + 16)
  tiff.writeUInt32LE(second, data + 20)
  tiff.writeUInt32LE(Math.max(0, primary - 10), data + 24)
  return segment(0xe2, join(new TextEncoder().encode('MPF\0'), tiff))
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

describe('cleaning originals for clients (plans/PLAN-FN-GALLERY-v3.md G0b)', () => {
  it('takes names, captions, keywords, comments and GPS out of a JPEG, keeps the picture and the camera, and credits the photographer', async () => {
    // The fixture really carries all of it (see make-fixtures.mjs).
    for (const secret of SECRETS) expect(text(privateJpeg)).toContain(secret)
    const { out, length } = await clean(privateJpeg)
    expect(length).toBe(out.length)
    for (const secret of SECRETS) expect(text(out)).not.toContain(secret)
    expect(await pixels(out)).toBe(await pixels(privateJpeg))
    const meta = await exifr.parse(out, { xmp: true, iptc: true, gps: true, mergeOutput: false })
    expect(meta.gps).toBeUndefined()
    expect(meta.iptc).toBeUndefined()
    expect(meta.ifd0).toMatchObject({ Make: 'Canon', Model: 'Canon EOS R5', Artist: 'Test Photographer', Copyright: '(c) Test' })
    expect(meta.ifd0.ImageDescription).toBeUndefined()
    expect(meta.exif).toMatchObject({ ExposureTime: 1 / 250, FNumber: 2.8, LensModel: 'RF85mm F1.2 L USM' })
    expect(meta.exif.UserComment).toBeUndefined()
    expect(meta.exif.OwnerName ?? meta.exif.CameraOwnerName).toBeUndefined()
    expect(text(out)).toContain('<rdf:li>Test Photographer</rdf:li>')
    expect(text(out)).toContain('© 2024 Test Studio'.replace('©', 'Â©')) // UTF-8 bytes, read as latin1
  })

  it('writes no XMP at all when the catalogue has no credit, and escapes it when it does', async () => {
    expect(text((await clean(privateJpeg, 'image/jpeg', { creator: null, copyright: null })).out)).not.toContain('xmpmeta')
    expect(text((await clean(privateJpeg, 'image/jpeg', { creator: 'A <b> & "c"', copyright: null })).out)).toContain('A &lt;b&gt; &amp; &quot;c&quot;')
  })

  it('drops C2PA, other APP segments and the second picture of a multi-picture file, keeping the length exact', async () => {
    const c2pa = segment(0xeb, new TextEncoder().encode('JP\0\0c2pa manifest made by Lily'))
    const second = await sharp(privateJpeg).resize(200).jpeg().withMetadata().toBuffer()
    const withSecond = (primary: Uint8Array) => join(primary, new Uint8Array(second))
    // The MPF segment's size field doesn't change its length, so the primary's size is known before building it.
    const base = afterSoi(privateJpeg, c2pa)
    const primarySize = base.length + mpfSegment(0, 0).length
    const file = withSecond(afterSoi(base, mpfSegment(primarySize, second.length)))
    expect(text(file)).toContain('c2pa')
    const { out, length } = await clean(file)
    expect(length).toBe(out.length)
    expect(text(out)).not.toContain('c2pa')
    expect(text(out)).not.toContain('MPF\0')
    for (const secret of SECRETS) expect(text(out)).not.toContain(secret)
    expect(endsWithEoi(out)).toBe(true)
    expect(await pixels(out)).toBe(await pixels(privateJpeg))
  })

  it('cuts a phone trailer after the picture, sending it without a length', async () => {
    const file = join(privateJpeg, new TextEncoder().encode('SEFH Lily trailer data SEFT'))
    const { out, length } = await clean(file)
    expect(length).toBeNull()
    expect(text(out)).not.toContain('trailer')
    expect(endsWithEoi(out)).toBe(true)
  })

  it('follows a progressive JPEG through all its scans', async () => {
    const progressive = new Uint8Array(await sharp(privateJpeg).jpeg({ progressive: true }).withMetadata().toBuffer())
    const { out } = await clean(progressive)
    expect(await pixels(out)).toBe(await pixels(progressive))
  })

  it('refuses what it can’t vouch for, before sending anything', async () => {
    await expect(clean(new TextEncoder().encode('not a jpeg at all'))).rejects.toBeInstanceOf(CleanError)
    await expect(clean(privateJpeg.subarray(0, 300))).rejects.toBeInstanceOf(CleanError)
    // An index saying the first picture ends inside its own head.
    await expect(clean(afterSoi(privateJpeg, mpfSegment(20, 10)))).rejects.toBeInstanceOf(CleanError)
  })

  it('cuts a stream short rather than send past where the index says the picture ends', async () => {
    const file = afterSoi(privateJpeg, mpfSegment(privateJpeg.length, 0)) // says the picture ends before it does
    const cleaned = await cleanOriginal(streamOf(file), 'image/jpeg', file.length, credit)
    await expect(bytesOf(cleaned.body)).rejects.toBeInstanceOf(CleanError)
  })

  it('removes a maker note and leaves the rest of the Exif readable', async () => {
    // IFD0 → Exif IFD holding ExposureTime and a MakerNote with a name in it.
    const tiff = Buffer.alloc(120)
    tiff.write('II', 0, 'latin1')
    tiff.writeUInt16LE(42, 2)
    tiff.writeUInt32LE(8, 4)
    tiff.writeUInt16LE(1, 8)
    tiff.writeUInt16LE(0x8769, 10)
    tiff.writeUInt16LE(4, 12)
    tiff.writeUInt32LE(1, 14)
    tiff.writeUInt32LE(26, 18)
    tiff.writeUInt16LE(2, 26)
    tiff.writeUInt16LE(0x829a, 28) // ExposureTime, RATIONAL at 80
    tiff.writeUInt16LE(5, 30)
    tiff.writeUInt32LE(1, 32)
    tiff.writeUInt32LE(80, 36)
    tiff.writeUInt16LE(0x927c, 40) // MakerNote, 16 bytes at 88
    tiff.writeUInt16LE(7, 42)
    tiff.writeUInt32LE(16, 44)
    tiff.writeUInt32LE(88, 48)
    tiff.writeUInt32LE(1, 80)
    tiff.writeUInt32LE(250, 84)
    tiff.write('Lily face name!!', 88, 'latin1')
    const app1 = segment(0xe1, join(new TextEncoder().encode('Exif\0\0'), tiff))
    cleanExif(app1)
    expect(text(app1)).not.toContain('Lily')
    const exif = await exifr.parse(join(new Uint8Array([0xff, 0xd8]), app1, new Uint8Array([0xff, 0xd9])), { mergeOutput: false, makerNote: true })
    expect(exif.exif).toMatchObject({ ExposureTime: 1 / 250 })
    expect(exif.exif.MakerNote).toBeUndefined()
  })

  it('keeps only a PNG’s picture and colour chunks, text after the image data included', async () => {
    const iend = privatePng.length - 12
    const file = join(privatePng.subarray(0, iend), pngChunk('tEXt', new TextEncoder().encode('Comment\0Lily after IDAT')), privatePng.subarray(iend))
    for (const secret of ['Lily', 'eXIf']) expect(text(file)).toContain(secret)
    expect(await exifr.parse(file, { gps: true })).toHaveProperty('latitude')
    const { out, length } = await clean(file, 'image/png')
    expect(length).toBeNull()
    expect(text(out)).not.toContain('Lily')
    expect(text(out)).not.toContain('eXIf')
    expect(text(out)).toContain('<rdf:li>Test Photographer</rdf:li>')
    expect(await pixels(out)).toBe(await pixels(privatePng))
    expect(await exifr.parse(out, { gps: true })).not.toHaveProperty('latitude')
  })

  it('takes EXIF and XMP out of a WebP rendition', async () => {
    const tagged = new Uint8Array(await sharp(privateJpeg).resize(100).webp().withMetadata().toBuffer())
    expect(text(tagged)).toMatch(/EXIF|XMP /)
    const stripped = webpWithoutMetadata(tagged)
    expect(text(stripped)).not.toMatch(/EXIF|XMP /)
    expect(await pixels(stripped)).toBe(await pixels(tagged))
    const plain = new Uint8Array(await sharp(privateJpeg).resize(100).webp().toBuffer())
    expect(webpWithoutMetadata(plain)).toBe(plain)
  })
})

describe('originals in a gallery', () => {
  let h: Harness
  let admin: string
  beforeEach(async () => {
    h = await createHarness()
    admin = await setUpAdmin(h)
  })
  afterEach(async () => h?.dispose())

  async function galleryWith(bytes: Uint8Array, filename: string, settings: Record<string, unknown>) {
    const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: bytes.byteLength }), cookie: admin })).json()) as { uploadId: string }
    const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: bytes.slice(), headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
    const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
    const { assetId } = (await done.json()) as { assetId: string }
    const album = ((await (await h.fetch('/api/albums', { ...json({ name: 'Family' }), cookie: admin })).json()) as { album: { id: string } }).album.id
    await h.fetch(`/api/albums/${album}/items`, { ...json({ assetIds: [assetId] }), cookie: admin })
    const share = ((await (await h.fetch('/api/shares', { ...json({ albumId: album, name: 'Family', title: 'Family', downloadSizes: ['original'], ...settings }), cookie: admin })).json()) as { share: { id: string; token: string } }).share
    return { assetId, share, url: `/api/public/galleries/${share.token}/assets/${assetId}/download/original` }
  }

  it('sends a cleaned original by default, whole even when a range is asked for, and the file as stored when the gallery says so', async () => {
    const { share, url } = await galleryWith(privateJpeg, 'lily.jpg', {})
    const res = await h.fetch(url, { headers: { Range: 'bytes=0-99' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('accept-ranges')).toBeNull()
    const out = new Uint8Array(await res.arrayBuffer())
    expect(res.headers.get('content-length')).toBe(String(out.length))
    for (const secret of SECRETS) expect(text(out)).not.toContain(secret)
    // Credited from the catalogue, which read it from the file's IPTC/XMP on upload.
    expect(text(out)).toContain('Test Photographer')

    expect((await h.fetch(`/api/shares/${share.id}`, { method: 'PATCH', body: JSON.stringify({ originalsAsStored: true }), cookie: admin })).status).toBe(200)
    expect(new Uint8Array(await (await h.fetch(url)).arrayBuffer())).toEqual(privateJpeg)
  })

  it('refuses an original it can’t clean, and tells the team', async () => {
    // Stored as uploaded (it starts like a JPEG), but its head can't be read, so it's never sent as such.
    const broken = join(privateJpeg.subarray(0, 2), new TextEncoder().encode('garbage that is not a marker'), privateJpeg.subarray(2))
    const { url } = await galleryWith(broken, 'broken.jpg', {})
    const res = await h.fetch(url)
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toBe('cannot_prepare')
    const activity = await h.env.DB.prepare("SELECT details FROM activity_log WHERE action = 'share.original_refused'").first<{ details: string }>()
    expect(JSON.parse(activity!.details)).toMatchObject({ title: 'Family' })
  })
})
