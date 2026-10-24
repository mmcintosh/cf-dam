import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { archiveOne, archiveStep, copyPartSize, jobsLook } from '../src/catalog/archive-jobs'
import { jobStorage } from '../src/catalog/job-storage'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))
const BIG = 17 * 1024 * 1024 + 123

let h: Harness
let admin: string
let s3Id: string
let jobId: string
let small: string
let big: string

const b64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const sha = async (bytes: ArrayBuffer) => {
  const view = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let s = ''
  for (const b of view) s += String.fromCharCode(b)
  return btoa(s)
}

/** An in-memory S3 that checks every checksum it's sent, and insists on one for each part. */
class FakeS3 {
  objects = new Map<string, { bytes: Uint8Array; storageClass: string; etag: string }>()
  uploads = new Map<string, { key: string; storageClass: string; parts: Map<number, { bytes: Uint8Array; etag: string; checksum: string }> }>()
  log: string[] = []
  /** Called before a part is stored: lets a test change the R2 original mid-copy. */
  beforePart?: (n: number) => Promise<void>
  private n = 0

  handle = async (input: Request | string, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const url = new URL(request.url)
    const key = decodeURIComponent(url.pathname.slice(1))
    const q = url.searchParams
    const header = (name: string) => request.headers.get(name)
    this.log.push(`${request.method} ${key}${url.search}`)
    if (request.method === 'HEAD') {
      const o = this.objects.get(key)
      if (!o) return new Response(null, { status: 404 })
      const headers: Record<string, string> = { 'Content-Length': String(o.bytes.byteLength), ETag: `"${o.etag}"` }
      if (o.storageClass !== 'STANDARD') headers['x-amz-storage-class'] = o.storageClass
      return new Response(null, { status: 200, headers })
    }
    if (request.method === 'POST' && q.has('uploads')) {
      const id = `up-${++this.n}`
      this.uploads.set(id, { key, storageClass: header('x-amz-storage-class') ?? 'STANDARD', parts: new Map() })
      return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`)
    }
    if (request.method === 'PUT' && q.has('partNumber')) {
      const upload = this.uploads.get(q.get('uploadId')!)!
      const bytes = new Uint8Array(await request.arrayBuffer())
      const checksum = header('x-amz-checksum-sha256')
      if (!checksum) return new Response('<Error><Code>InvalidRequest</Code></Error>', { status: 400 })
      if (checksum !== (await sha(bytes.buffer))) return new Response('<Error><Code>BadDigest</Code></Error>', { status: 400 })
      const n = Number(q.get('partNumber'))
      await this.beforePart?.(n)
      const etag = `part-${n}-${bytes.byteLength}`
      upload.parts.set(n, { bytes, etag, checksum })
      return new Response(null, { status: 200, headers: { ETag: `"${etag}"` } })
    }
    if (request.method === 'POST' && q.has('uploadId')) {
      const upload = this.uploads.get(q.get('uploadId')!)!
      const xml = await request.text()
      const parts = [...xml.matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>"([^"]+)"<\/ETag><ChecksumSHA256>([^<]+)<\/ChecksumSHA256>/g)]
      for (const [, n, etag, checksum] of parts) {
        const part = upload.parts.get(Number(n))
        if (!part || part.etag !== etag || part.checksum !== checksum) return new Response('<Error><Code>InvalidPart</Code></Error>', { status: 400 })
      }
      const total = parts.reduce((s, [, n]) => s + upload.parts.get(Number(n))!.bytes.byteLength, 0)
      const bytes = new Uint8Array(total)
      let at = 0
      for (const [, n] of parts) {
        bytes.set(upload.parts.get(Number(n))!.bytes, at)
        at += upload.parts.get(Number(n))!.bytes.byteLength
      }
      this.objects.set(upload.key, { bytes, storageClass: upload.storageClass, etag: `mp-${parts.length}` })
      this.uploads.delete(q.get('uploadId')!)
      return new Response(`<CompleteMultipartUploadResult><ETag>"mp-${parts.length}"</ETag></CompleteMultipartUploadResult>`)
    }
    if (request.method === 'DELETE' && q.has('uploadId')) {
      this.uploads.delete(q.get('uploadId')!)
      return new Response(null, { status: 204 })
    }
    if (request.method === 'DELETE') {
      this.objects.delete(key)
      return new Response(null, { status: 204 })
    }
    if (request.method === 'PUT' && header('x-amz-copy-source')) {
      const o = this.objects.get(key)!
      o.storageClass = header('x-amz-storage-class') ?? 'STANDARD'
      o.etag = `copied-${o.etag}`
      return new Response(`<CopyObjectResult><ETag>"${o.etag}"</ETag></CopyObjectResult>`)
    }
    if (request.method === 'PUT') {
      const bytes = new Uint8Array(await request.arrayBuffer())
      const checksum = header('x-amz-checksum-sha256')
      if (checksum && checksum !== (await sha(bytes.buffer))) return new Response('<Error><Code>BadDigest</Code></Error>', { status: 400 })
      this.objects.set(key, { bytes, storageClass: header('x-amz-storage-class') ?? 'STANDARD', etag: `single-${bytes.byteLength}` })
      return new Response(null, { status: 200, headers: { ETag: `"single-${bytes.byteLength}"` } })
    }
    return new Response(null, { status: 400 })
  }
}

async function upload(filename: string): Promise<string> {
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

let s3: FakeS3

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  s3 = new FakeS3()
  small = await upload('small.jpg')
  // A big original straight into R2 (as an agent upload would leave it).
  big = 'bigasset0000000000000000000000001'
  const now = new Date().toISOString()
  const bytes = new Uint8Array(BIG)
  for (let i = 0; i < bytes.length; i += 4096) bytes[i] = i % 251
  await h.env.MEDIA_BUCKET!.put('originals/big/big.cr3', bytes)
  await h.env.DB.batch([
    h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) VALUES (?, 'big.cr3', 'image/x-canon-cr3', ?, 'ready', ?, ?)").bind(big, BIG, now, now),
    h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, size, updated_at) VALUES (?, 'r2', 'originals/big/big.cr3', 'STANDARD', 'present', ?, ?)").bind(big, BIG, now),
  ])
  s3Id = ((await (await h.fetch('/api/connections', {
    ...json({ name: 'AWS', endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'us-east-1', bucket: 'archive', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' }),
    cookie: admin,
  })).json()) as { connection: { id: string } }).connection.id
  const client = ((await (await h.fetch('/api/clients', { ...json({ name: 'Hansen' }), cookie: admin })).json()) as { client: { id: string } }).client.id
  jobId = ((await (await h.fetch('/api/jobs', { ...json({ clientId: client, title: 'Hansen wedding', stage: 'delivered' }), cookie: admin })).json()) as { job: { id: string } }).job.id
  const album = ((await (await h.fetch('/api/albums', { ...json({ name: 'All' }), cookie: admin })).json()) as { album: { id: string } }).album.id
  await h.fetch(`/api/albums/${album}/items`, { ...json({ assetIds: [small, big] }), cookie: admin })
  await h.fetch(`/api/jobs/${jobId}/albums`, { ...json({ albumId: album }), cookie: admin })
  vi.stubGlobal('fetch', s3.handle)
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await h.dispose()
})

const settings = (body: Record<string, unknown>) => h.fetch('/api/archive/jobs', { method: 'PUT', body: JSON.stringify(body), cookie: admin })
const ageDelivery = (days: number) => h.env.DB.prepare('UPDATE jobs SET archive_from = ? WHERE id = ?').bind(new Date(Date.now() - days * 86_400_000).toISOString(), jobId).run()
const drain = async () => {
  for (let i = 0; i < 20; i++) if ((await archiveOne(h.env)) === 'none') return
}
const more = () => true
const step = async () => archiveStep(h.env, more, await jobsLook(h.env.DB))

describe('archiving delivered jobs', () => {
  it('copies a delivered job to Deep Archive after its days: checked parts, sizes match, R2 kept', async () => {
    expect((await settings({ enabled: true, connectionId: s3Id, storageClass: 'DEEP_ARCHIVE', afterDays: 30 })).status).toBe(200)
    // Not due yet.
    await ageDelivery(10)
    expect(await step()).toBe(0)
    // Due: the preview counts it, then the sweep lists both originals.
    await ageDelivery(31)
    const preview = (await (await h.fetch('/api/archive/jobs', { cookie: admin })).json()) as { preview: { jobs: number; photos: number; bytes: number } }
    expect(preview.preview).toMatchObject({ jobs: 1, photos: 2 })
    expect(await step()).toBe(2)
    await drain()

    expect(copyPartSize(BIG)).toBe(16 * 1024 * 1024)
    const parts = s3.log.filter((l) => l.includes('partNumber'))
    expect(parts).toHaveLength(2)
    const stored = [...s3.objects.values()]
    expect(stored.map((o) => [o.storageClass, o.bytes.byteLength]).sort()).toEqual([['DEEP_ARCHIVE', BIG], ['DEEP_ARCHIVE', camera.byteLength]].sort())
    const r2 = new Uint8Array(await (await h.env.MEDIA_BUCKET!.get('originals/big/big.cr3'))!.arrayBuffer())
    const copy = stored.find((o) => o.bytes.byteLength === BIG)!.bytes
    expect(copy.every((b, i) => b === r2[i])).toBe(true)

    const locations = await h.env.DB.prepare('SELECT asset_id, connection_id, storage_class, state, size FROM asset_locations WHERE asset_id IN (?, ?) ORDER BY connection_id').bind(small, big).all()
    expect(locations.results.filter((l) => l.connection_id === 'r2')).toHaveLength(2)
    expect(locations.results.filter((l) => l.connection_id === s3Id).map((l) => [l.storage_class, l.state])).toEqual([['DEEP_ARCHIVE', 'present'], ['DEEP_ARCHIVE', 'present']])

    await step()
    const job = await h.env.DB.prepare('SELECT archive_state, archived_at FROM jobs WHERE id = ?').bind(jobId).first<{ archive_state: string; archived_at: string }>()
    expect(job?.archive_state).toBe('done')
    expect((await jobStorage(h.env.DB, [jobId])).get(jobId)).toMatchObject({ photos: 2, readable: 2, coldBackup: 2 })
    const log = await h.env.DB.prepare("SELECT action FROM activity_log WHERE target_id = ? AND action = 'job.archived'").bind(jobId).all()
    expect(log.results).toHaveLength(1)
  })

  it('keeps its copies and the connection test inside the connection’s folder, where a keyless role may write', async () => {
    await h.env.DB.prepare("UPDATE storage_connections SET prefix = 'studio/' WHERE id = ?").bind(s3Id).run()
    expect((await settings({ enabled: true, connectionId: s3Id, afterDays: 0 })).status).toBe(200)
    await step()
    await drain()
    const stored = [...s3.objects.keys()]
    expect(stored).toHaveLength(2)
    expect(stored.every((k) => k.startsWith('studio/originals/'))).toBe(true)
    const keys = await h.env.DB.prepare('SELECT key FROM asset_locations WHERE connection_id = ?').bind(s3Id).all<{ key: string }>()
    expect(keys.results.every((r) => r.key.startsWith('studio/originals/'))).toBe(true)

    const tested = await h.fetch(`/api/connections/${s3Id}/test`, { method: 'POST', cookie: admin })
    expect(await tested.json()).toEqual({ ok: true })
    expect(s3.log.filter((l) => l.includes('.cf-dam-connection-test'))).toEqual([
      'PUT studio/.cf-dam-connection-test',
      'HEAD studio/.cf-dam-connection-test',
      'DELETE studio/.cf-dam-connection-test',
    ])
  })

  it('starts the copy again when the R2 original changes on the way', async () => {
    await settings({ enabled: true, connectionId: s3Id, afterDays: 0 })
    await step()
    let changed = false
    s3.beforePart = async (n) => {
      if (n === 2 && !changed) {
        changed = true
        await h.env.MEDIA_BUCKET!.put('originals/big/big.cr3', new Uint8Array(BIG).fill(7))
      }
    }
    await drain()
    const copy = [...s3.objects.values()].find((o) => o.bytes.byteLength === BIG)!
    // The copy is of the new bytes, made after a fresh start.
    expect(copy.bytes.every((b) => b === 7)).toBe(true)
    expect(s3.log.some((l) => l.startsWith('DELETE') && l.includes('uploadId'))).toBe(true)
    const item = await h.env.DB.prepare('SELECT state, attempts FROM archive_items WHERE asset_id = ?').bind(big).first<{ state: string; attempts: number }>()
    expect(item).toEqual({ state: 'done', attempts: 1 })
  })

  it('restarts the clock on re-delivery, skips Keep hot, and archives now in a chosen class', async () => {
    await settings({ enabled: true, connectionId: s3Id, afterDays: 30 })
    await ageDelivery(40)
    // Back to editing, then delivered again: the clock starts again, so it isn't due.
    await h.fetch(`/api/jobs/${jobId}/stage`, { ...json({ stage: 'editing' }), cookie: admin })
    await h.fetch(`/api/jobs/${jobId}/stage`, { ...json({ stage: 'delivered' }), cookie: admin })
    expect(await step()).toBe(0)
    // Keep hot: never due.
    await ageDelivery(40)
    await h.fetch(`/api/jobs/${jobId}/keep-hot`, { ...json({ keepHot: true }), cookie: admin })
    expect(await step()).toBe(0)
    // Archive now, in Glacier Flexible.
    const now = await h.fetch(`/api/jobs/${jobId}/archive-now`, { ...json({ storageClass: 'GLACIER' }), cookie: admin })
    expect(now.status).toBe(202)
    await drain()
    expect([...s3.objects.values()].map((o) => o.storageClass)).toEqual(['GLACIER', 'GLACIER'])
  })

  it('moves a warm S3 copy to the cold class and keeps its new ETag', async () => {
    await settings({ enabled: true, connectionId: s3Id, afterDays: 0 })
    s3.objects.set('warm/big.cr3', { bytes: new Uint8Array(10), storageClass: 'STANDARD', etag: 'warm-1' })
    await h.env.DB.batch([
      h.env.DB.prepare("DELETE FROM asset_locations WHERE asset_id = ? AND connection_id = 'r2'").bind(big),
      h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, size, etag, updated_at) VALUES (?, ?, 'warm/big.cr3', 'STANDARD', 'present', 10, 'warm-1', ?)").bind(big, s3Id, new Date().toISOString()),
    ])
    await step()
    await drain()
    const row = await h.env.DB.prepare('SELECT storage_class, etag FROM asset_locations WHERE asset_id = ? AND connection_id = ?').bind(big, s3Id).first()
    expect(row).toEqual({ storage_class: 'DEEP_ARCHIVE', etag: 'copied-warm-1' })
  })

  it('refuses settings that point at a NAS or R2, and needs a connection to turn on', async () => {
    expect((await settings({ enabled: true })).status).toBe(400)
    expect((await settings({ enabled: true, connectionId: 'r2' })).status).toBe(400)
    expect((await settings({ connectionId: s3Id, storageClass: 'STANDARD' })).status).toBe(400)
  })
})
