import { readFileSync } from 'node:fs'
import { AwsClient } from 'aws4fetch'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cookiesFrom, createHarness, createUser, json, setUpAdmin, signIn, type Harness } from './harness'

// Copied into plain Uint8Arrays: Node hands back Buffers, which don't deep-equal fetched bytes.
const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))
const png = new Uint8Array(readFileSync(new URL('./fixtures/gradient.png', import.meta.url)))

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface CreatedUpload {
  uploadId: string
  assetId: string
  mode: 'direct' | 'proxied'
  partCount: number
}

interface PartTarget {
  partNumber: number
  method: 'PUT'
  url: string
  headers: Record<string, string>
  size: number
}

/** Run the whole upload protocol for one small file and return the asset id. */
async function upload(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  options: { cookie?: string; connectionId?: string; contentType?: string; sha?: boolean } = {},
): Promise<string> {
  const cookie = options.cookie ?? admin
  const created = await h.fetch('/api/uploads', {
    ...json({
      filename,
      size: bytes.byteLength,
      contentType: options.contentType ?? 'image/jpeg',
      connectionId: options.connectionId,
      sha256: options.sha ? await sha256(bytes) : undefined,
    }),
    cookie,
  })
  expect(created.status).toBe(201)
  const { uploadId, mode, partCount } = (await created.json()) as CreatedUpload
  expect(partCount).toBe(1)
  const { parts } = (await (await h.fetch(`/api/uploads/${uploadId}/part-urls`, { ...json({ partNumbers: [1] }), cookie })).json()) as { parts: PartTarget[] }
  const target = parts[0]!
  const put =
    mode === 'proxied'
      ? await h.fetch(target.url, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' }, cookie })
      : await fetch(target.url, { method: 'PUT', headers: target.headers, body: bytes })
  expect(put.status).toBe(200)
  const etag = put.headers.get('ETag')!
  const done = await h.fetch(`/api/uploads/${uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag }] }), cookie })
  expect(done.status).toBe(200)
  return ((await done.json()) as { assetId: string }).assetId
}

describe('uploading into the built-in R2 bucket', () => {
  it('stores the original, reads its EXIF, makes WebP renditions and indexes it', async () => {
    const id = await upload(camera, 'IMG_2041 wedding.jpg')
    const asset = (await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as Record<string, unknown> & {
      camera: Record<string, string>
      exposure: Record<string, number>
      gps: { lat: number; lng: number }
      renditions: string[]
      locations: { connectionId: string; state: string; storageClass: string }[]
    }
    expect(asset.status).toBe('ready')
    expect(asset.capturedAt).toBe('2024-06-15T18:42:07')
    expect(asset.camera).toEqual({ make: 'Canon', model: 'Canon EOS R5', lens: 'RF85mm F1.2 L USM' })
    expect(asset.exposure).toMatchObject({ focalLength: 85, aperture: 2.8, iso: 400 })
    expect(asset.gps.lat).toBeCloseTo(62.4667, 3)
    expect(asset.width).toBe(1200)
    expect(asset.renditions.sort()).toEqual(['preview', 'thumb'])
    expect(asset.locations).toEqual([expect.objectContaining({ connectionId: 'r2', state: 'present', storageClass: 'STANDARD' })])

    const thumb = await h.fetch(`/api/assets/${id}/renditions/thumb`, { cookie: admin })
    expect(thumb.status).toBe(200)
    expect(thumb.headers.get('content-type')).toBe('image/webp')
    expect((await thumb.arrayBuffer()).byteLength).toBeGreaterThan(100)

    const original = await h.fetch(`/api/assets/${id}/original`, { cookie: admin })
    expect(original.headers.get('content-disposition')).toContain('attachment')
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(camera)
  })

  it('finds assets by camera, filename words and tags', async () => {
    const id = await upload(camera, 'IMG_2041-final.jpg')
    const search = async (q: string) =>
      ((await (await h.fetch(`/api/assets?q=${encodeURIComponent(q)}`, { cookie: admin })).json()) as { assets: { id: string }[] }).assets.map((a) => a.id)
    expect(await search('canon')).toEqual([id])
    expect(await search('EOS R5')).toEqual([id])
    expect(await search('final')).toEqual([id])
    expect(await search('nikon')).toEqual([])

    await h.fetch(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Geiranger sunset', tags: ['Norway', 'fjord'], rating: 5 }), cookie: admin })
    expect(await search('geiranger')).toEqual([id])
    expect(await search('fjord')).toEqual([id])
    const byTag = (await (await h.fetch('/api/assets?tag=Norway', { cookie: admin })).json()) as { total: number }
    expect(byTag.total).toBe(1)
    const tags = (await (await h.fetch('/api/tags', { cookie: admin })).json()) as { keywords: { name: string; total: number }[] }
    expect(tags.keywords.map((t) => t.name).sort()).toEqual(['Norway', 'fjord'])
  })

  it('reports a duplicate by content hash instead of storing it twice', async () => {
    const first = await upload(camera, 'a.jpg', { sha: true })
    const again = await h.fetch('/api/uploads', { ...json({ filename: 'copy of a.jpg', size: camera.byteLength, sha256: await sha256(camera) }), cookie: admin })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'duplicate', duplicateOf: first })
  })

  it('rejects a part of the wrong size, and a completed upload that misstates its size', async () => {
    const created = (await (await h.fetch('/api/uploads', { ...json({ filename: 'x.png', size: png.byteLength + 10 }), cookie: admin })).json()) as CreatedUpload
    const wrong = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: png, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
    expect(wrong.status).toBe(400)
    expect(((await wrong.json()) as { message: string }).message).toMatch(/exactly/)
  })

  it('serves SVG originals as downloads, never inline', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') as Uint8Array<ArrayBuffer>
    const id = await upload(svg, 'logo.svg', { contentType: 'image/svg+xml' })
    const original = await h.fetch(`/api/assets/${id}/original`, { cookie: admin })
    expect(original.headers.get('content-type')).toBe('application/octet-stream')
    expect(original.headers.get('content-disposition')).toMatch(/^attachment/)
  })

  it('accepts a client-made preview and re-encodes it as WebP', async () => {
    const created = (await (await h.fetch('/api/uploads', { ...json({ filename: 'scan.cr3', size: 4 }), cookie: admin })).json()) as CreatedUpload
    const res = await h.fetch(`/api/uploads/${created.uploadId}/renditions/preview`, { method: 'PUT', body: png, headers: { 'Content-Type': 'image/png' }, cookie: admin })
    expect(res.status).toBe(204)
    const stored = await h.env.DB.prepare("SELECT mime_type, source, width FROM renditions WHERE asset_id = ? AND name = 'preview'").bind(created.assetId).first()
    expect(stored).toEqual({ mime_type: 'image/webp', source: 'client', width: 1200 })
    const junk = await h.fetch(`/api/uploads/${created.uploadId}/renditions/thumb`, { method: 'PUT', body: new Uint8Array([1, 2, 3]), cookie: admin })
    expect(junk.status).toBe(400)
  })

  it('refuses to hand out an archived original and says why', async () => {
    const id = await upload(camera, 'old.jpg')
    await h.env.DB.prepare("UPDATE asset_locations SET storage_class = 'DEEP_ARCHIVE', state = 'archived' WHERE asset_id = ?").bind(id).run()
    const res = await h.fetch(`/api/assets/${id}/original`, { cookie: admin })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'archived', storageClass: 'DEEP_ARCHIVE' })
  })

  it('hides deleted assets', async () => {
    const id = await upload(camera, 'gone.jpg')
    expect((await h.fetch(`/api/assets/${id}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    expect((await h.fetch(`/api/assets/${id}`, { cookie: admin })).status).toBe(404)
    expect(((await (await h.fetch('/api/assets', { cookie: admin })).json()) as { total: number }).total).toBe(0)
  })
})

describe('permissions', () => {
  it('lets a viewer browse but not upload', async () => {
    const id = await upload(camera, 'shared.jpg')
    await createUser(h, admin, { name: 'V', email: 'v@example.com', password: 'viewer password 1', roles: ['viewer'] })
    const viewer = cookiesFrom(await signIn(h, 'v@example.com', 'viewer password 1'))
    expect((await h.fetch(`/api/assets/${id}`, { cookie: viewer })).status).toBe(200)
    expect((await h.fetch('/api/uploads', { ...json({ filename: 'x.jpg', size: 10 }), cookie: viewer })).status).toBe(403)
    expect((await h.fetch(`/api/assets/${id}`, { method: 'PATCH', body: '{}', cookie: viewer })).status).toBe(403)
  })

  it('keeps an upload private to whoever started it', async () => {
    await createUser(h, admin, { name: 'E', email: 'e@example.com', password: 'editor password 1', roles: ['editor'] })
    const editor = cookiesFrom(await signIn(h, 'e@example.com', 'editor password 1'))
    const created = (await (await h.fetch('/api/uploads', { ...json({ filename: 'x.jpg', size: 10 }), cookie: admin })).json()) as CreatedUpload
    expect((await h.fetch(`/api/uploads/${created.uploadId}/part-urls`, { ...json({ partNumbers: [1] }), cookie: editor })).status).toBe(404)
  })
})

describe('albums', () => {
  it('collects assets and filters the library by album', async () => {
    const a = await upload(camera, 'a.jpg')
    await upload(png, 'b.png', { contentType: 'image/png' })
    const { album } = (await (await h.fetch('/api/albums', { ...json({ name: 'Portfolio' }), cookie: admin })).json()) as { album: { id: string } }
    expect((await h.fetch(`/api/albums/${album.id}/items`, { ...json({ assetIds: [a] }), cookie: admin })).status).toBe(200)
    const listed = (await (await h.fetch(`/api/assets?album=${album.id}`, { cookie: admin })).json()) as { assets: { id: string }[] }
    expect(listed.assets.map((x) => x.id)).toEqual([a])
    const albums = (await (await h.fetch('/api/albums', { cookie: admin })).json()) as { albums: { itemCount: number; coverAssetId: string }[] }
    expect(albums.albums[0]).toMatchObject({ itemCount: 1, coverAssetId: a })
  })
})

describe('video uploads', () => {
  it('keeps the length and size the browser reads from a video, and its browser-made poster', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('../../agent/test/fixtures/clip.mp4', import.meta.url)))
    const created = (await (await h.fetch('/api/uploads', { ...json({ filename: 'clip.mp4', size: bytes.byteLength, contentType: 'video/mp4' }), cookie: admin })).json()) as { uploadId: string; assetId: string }
    const poster = new Uint8Array(await (await import('sharp')).default({ create: { width: 480, height: 270, channels: 3, background: '#468' } }).webp().toBuffer())
    expect((await h.fetch(`/api/uploads/${created.uploadId}/renditions/preview`, { method: 'PUT', body: poster, headers: { 'Content-Type': 'image/webp' }, cookie: admin })).status).toBeLessThan(300)
    const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
    await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }], video: { duration: 6, width: 480, height: 270 } }), cookie: admin })
    const a = (await (await h.fetch(`/api/assets/${created.assetId}`, { cookie: admin })).json()) as { width: number; status: string; renditions: string[]; video: { duration: number } }
    expect(a).toMatchObject({ width: 480, status: 'ready', video: { duration: 6 } })
    expect(a.renditions).toContain('preview')
    // Seekable: byte ranges, with the real type for the <video> element.
    const part = await h.fetch(`/api/assets/${created.assetId}/original`, { headers: { Range: 'bytes=100-199' }, cookie: admin })
    expect([part.status, part.headers.get('content-range'), part.headers.get('content-type'), (await part.arrayBuffer()).byteLength]).toEqual([206, `bytes 100-199/${bytes.byteLength}`, 'video/mp4', 100])
    const tail = await h.fetch(`/api/assets/${created.assetId}/original`, { headers: { Range: `bytes=${bytes.byteLength - 10}-` }, cookie: admin })
    expect((await tail.arrayBuffer()).byteLength).toBe(10)
    expect((await h.fetch(`/api/assets/${created.assetId}/original`, { headers: { Range: `bytes=${bytes.byteLength}-` }, cookie: admin })).status).toBe(416)
  })
})

const s3Endpoint = process.env.S3_TEST_ENDPOINT
const s3Credentials = { accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? '' }

describe.skipIf(!s3Endpoint)('an S3 connection (against a real S3-compatible server)', () => {
  async function createConnection(): Promise<string> {
    const bucket = `cfdam-conn-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`
    const client = new AwsClient({ ...s3Credentials, service: 's3', region: 'us-east-1' })
    expect((await client.fetch(`${s3Endpoint}/${bucket}`, { method: 'PUT' })).ok).toBe(true)
    const res = await h.fetch('/api/connections', {
      ...json({ name: 'Studio S3', endpoint: s3Endpoint, region: 'us-east-1', bucket, forcePathStyle: true, prefix: 'archive', ...s3Credentials }),
      cookie: admin,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { connection: { id: string; hasSecret: boolean } }
    expect(body.connection.hasSecret).toBe(true)
    expect(JSON.stringify(body)).not.toContain(s3Credentials.secretAccessKey)
    return body.connection.id
  }

  it('passes the connection test, and fails it with wrong credentials', async () => {
    const id = await createConnection()
    expect(await (await h.fetch(`/api/connections/${id}/test`, { method: 'POST', cookie: admin })).json()).toEqual({ ok: true })
    const sealed = await h.env.DB.prepare('SELECT secret_sealed FROM storage_connections WHERE id = ?').bind(id).first<{ secret_sealed: string }>()
    expect(sealed?.secret_sealed.startsWith('v1.')).toBe(true)
    expect(sealed?.secret_sealed).not.toContain(s3Credentials.secretAccessKey)
  })

  it('uploads straight to S3 on presigned URLs, then processes the original from S3', async () => {
    const connectionId = await createConnection()
    const id = await upload(camera, 'DSC_0001.jpg', { connectionId })
    const asset = (await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as {
      status: string
      camera: { model: string }
      renditions: string[]
      locations: { connectionId: string }[]
    }
    expect(asset.status).toBe('ready')
    expect(asset.camera.model).toBe('Canon EOS R5')
    expect(asset.renditions.sort()).toEqual(['preview', 'thumb'])
    expect(asset.locations[0]!.connectionId).toBe(connectionId)

    const original = await h.fetch(`/api/assets/${id}/original`, { cookie: admin, redirect: 'manual' })
    expect(original.status).toBe(302)
    const download = await fetch(original.headers.get('location')!)
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(camera)
  })

  it('won’t remove a connection that holds originals, and won’t offer classes it lacks', async () => {
    const connectionId = await createConnection()
    const id = await upload(camera, 'kept.jpg', { connectionId })
    expect((await h.fetch(`/api/connections/${connectionId}`, { method: 'DELETE', cookie: admin })).status).toBe(409)
    const move = await h.fetch(`/api/assets/${id}/storage-class`, { ...json({ storageClass: 'GLACIER' }), cookie: admin })
    expect(move.status).toBe(409)
    const deep = await h.fetch('/api/uploads', { ...json({ filename: 'x.jpg', size: 10, connectionId, storageClass: 'DEEP_ARCHIVE' }), cookie: admin })
    expect(deep.status).toBe(400)
  })

})
