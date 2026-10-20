import { readFileSync } from 'node:fs'
import { AwsClient } from 'aws4fetch'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkStorage, compare } from '../src/catalog/checks'
import { runSweep } from '../src/catalog/sweeper'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

const sha256 = async (b: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('')

interface PartTarget {
  url: string
  headers: Record<string, string>
}

/** The whole upload protocol for one small file, into R2 or the given connection. */
async function upload(bytes: Uint8Array<ArrayBuffer>, filename: string, options: { connectionId?: string; sha?: boolean } = {}): Promise<string> {
  const created = await h.fetch('/api/uploads', {
    ...json({ filename, size: bytes.byteLength, contentType: 'image/jpeg', connectionId: options.connectionId, sha256: options.sha ? await sha256(bytes) : undefined, allowDuplicate: true }),
    cookie: admin,
  })
  expect(created.status).toBe(201)
  const { uploadId, mode } = (await created.json()) as { uploadId: string; mode: 'direct' | 'proxied' }
  const { parts } = (await (await h.fetch(`/api/uploads/${uploadId}/part-urls`, { ...json({ partNumbers: [1] }), cookie: admin })).json()) as { parts: PartTarget[] }
  const target = parts[0]!
  const put =
    mode === 'proxied'
      ? await h.fetch(target.url, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
      : await fetch(target.url, { method: 'PUT', headers: target.headers, body: bytes })
  expect(put.status).toBe(200)
  const done = await h.fetch(`/api/uploads/${uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  expect(done.status).toBe(200)
  return ((await done.json()) as { assetId: string }).assetId
}

interface LocationRow {
  key: string
  storage_class: string
  check_result: string | null
  check_detail: string | null
  checked_at: string | null
  check_due_at: string | null
}
const location = (assetId: string) => h.env.DB.prepare('SELECT key, storage_class, check_result, check_detail, checked_at, check_due_at FROM asset_locations WHERE asset_id = ?').bind(assetId).first<LocationRow>()
const check = () => checkStorage(h.env, () => true)
const bucket = () => h.env.MEDIA_BUCKET!
/** Make every location due again, as if a cycle had passed. */
const nextCycle = () => h.env.DB.prepare('UPDATE asset_locations SET check_due_at = NULL').run()
const problemsLogged = async () => (await h.env.DB.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'storage.check_problem'").first<{ n: number }>())!.n

describe('comparing what a store says with the catalog', () => {
  const row = { size: 100, etag: '"abc"', storage_class: 'STANDARD', sha256: 'aa'.repeat(32) }
  const head = { size: 100, etag: 'abc', contentType: null, storageClass: 'STANDARD', lastModified: null, restore: null }

  it('accepts the same size and etag, quoted or not, and follows a changed class', () => {
    expect(compare(row, head)).toMatchObject({ result: 'ok', adopt: {} })
    expect(compare(row, { ...head, storageClass: 'DEEP_ARCHIVE' })).toMatchObject({ result: 'ok', adopt: { storageClass: 'DEEP_ARCHIVE' } })
  })

  it('finds missing, resized, replaced and differently hashed files', () => {
    expect(compare(row, null).result).toBe('missing')
    expect(compare(row, { ...head, size: 99 })).toMatchObject({ result: 'changed', detail: expect.stringContaining('99 bytes') })
    expect(compare(row, { ...head, etag: 'def' }).result).toBe('changed')
    expect(compare(row, { ...head, sha256: 'bb'.repeat(32) }).result).toBe('changed')
    expect(compare(row, { ...head, sha256: 'AA'.repeat(32) }).result).toBe('ok')
  })

  it('takes size and etag from the store when the catalog never had them', () => {
    expect(compare({ ...row, size: null, etag: null }, head)).toMatchObject({ result: 'ok', adopt: { size: 100, etag: 'abc' } })
  })
})

describe('checking R2 originals', () => {
  it('passes a fresh upload, and proves it byte for byte when its SHA-256 is known', async () => {
    const id = await upload(camera, 'IMG_1.jpg', { sha: true })
    expect(await check()).toEqual({ checked: 1, problems: 0 })
    const loc = await location(id)
    expect(loc).toMatchObject({ check_result: 'ok', check_detail: null })
    expect(Date.parse(loc!.check_due_at!)).toBeGreaterThan(Date.now() + 29 * 86_400_000)
    expect(await h.env.DB.prepare('SELECT sha256_verified FROM assets WHERE id = ?').bind(id).first('sha256_verified')).toBe(1)
    // Not due again this cycle.
    expect(await check()).toEqual({ checked: 0, problems: 0 })
  })

  it('reports a deleted original once, until it comes back', async () => {
    const id = await upload(camera, 'IMG_2.jpg')
    const { key } = (await location(id))!
    await bucket().delete(key)
    expect(await check()).toEqual({ checked: 1, problems: 1 })
    expect(await location(id)).toMatchObject({ check_result: 'missing' })
    await nextCycle()
    await check()
    expect(await problemsLogged()).toBe(1)

    // Put back, and checked again on request.
    await bucket().put(key, camera)
    await h.env.DB.prepare('UPDATE asset_locations SET etag = NULL, size = NULL WHERE asset_id = ?').bind(id).run()
    expect((await h.fetch('/api/storage-checks/recheck', { ...json({ assetId: id, connectionId: 'r2' }), cookie: admin })).status).toBe(204)
    await check()
    expect(await location(id)).toMatchObject({ check_result: 'ok' })
  })

  it('reports a truncated or replaced original', async () => {
    const a = await upload(camera, 'IMG_3.jpg')
    const b = await upload(camera, 'IMG_4.jpg')
    await bucket().put((await location(a))!.key, camera.slice(0, 1000))
    const replaced = camera.slice()
    replaced[replaced.length - 3] = replaced[replaced.length - 3]! ^ 0xff
    await bucket().put((await location(b))!.key, replaced)
    expect(await check()).toEqual({ checked: 2, problems: 2 })
    expect(await location(a)).toMatchObject({ check_result: 'changed', check_detail: expect.stringContaining('1,000 bytes') })
    expect(await location(b)).toMatchObject({ check_result: 'changed', check_detail: expect.stringContaining('etag') })
  })

  it('catches contents that differ from the upload when read back', async () => {
    const id = await upload(camera, 'IMG_5.jpg', { sha: true })
    // As if the bytes had rotted under the same name, size and etag.
    await h.env.DB.prepare('UPDATE assets SET sha256 = ? WHERE id = ?').bind('00'.repeat(32), id).run()
    await check()
    expect(await location(id)).toMatchObject({ check_result: 'changed', check_detail: expect.stringContaining('SHA-256') })
    expect(await h.env.DB.prepare('SELECT sha256_verified FROM assets WHERE id = ?').bind(id).first('sha256_verified')).toBe(0)
  })

  it('follows a changed storage class without calling it a problem', async () => {
    const id = await upload(camera, 'IMG_6.jpg')
    await h.env.DB.prepare("UPDATE asset_locations SET storage_class = 'STANDARD_IA' WHERE asset_id = ?").bind(id).run()
    await check()
    expect(await location(id)).toMatchObject({ check_result: 'ok', storage_class: 'STANDARD' })
  })

  it('runs in the minute sweep, and shows on the Storage page', async () => {
    const ok = await upload(camera, 'IMG_7.jpg')
    const gone = await upload(camera, 'IMG_8.jpg')
    await bucket().delete((await location(gone))!.key)
    expect(await runSweep(h.env)).toMatchObject({ checked: 2, checkProblems: 1 })
    const page = (await (await h.fetch('/api/storage-checks', { cookie: admin })).json()) as {
      totals: Record<string, number>
      problems: { assetId: string; filename: string; connectionName: string; result: string }[]
    }
    expect(page.totals).toMatchObject({ ok: 1, missing: 1, unchecked: 0 })
    expect(page.problems).toEqual([expect.objectContaining({ assetId: gone, filename: 'IMG_8.jpg', result: 'missing' })])
    expect(page.problems.some((p) => p.assetId === ok)).toBe(false)
  })
})

const s3Endpoint = process.env.S3_TEST_ENDPOINT
const s3Credentials = { accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? '' }

describe.skipIf(!s3Endpoint)('checking S3 originals (against a real S3-compatible server)', () => {
  it('passes an upload and reports it once deleted', async () => {
    const bucket = `cfdam-checks-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`
    const client = new AwsClient({ ...s3Credentials, service: 's3', region: 'us-east-1' })
    expect((await client.fetch(`${s3Endpoint}/${bucket}`, { method: 'PUT' })).ok).toBe(true)
    const res = await h.fetch('/api/connections', {
      ...json({ name: 'Studio S3', endpoint: s3Endpoint, region: 'us-east-1', bucket, forcePathStyle: true, ...s3Credentials }),
      cookie: admin,
    })
    const connectionId = ((await res.json()) as { connection: { id: string } }).connection.id
    const id = await upload(camera, 'DSC_1.jpg', { connectionId })
    expect(await check()).toEqual({ checked: 1, problems: 0 })

    await client.fetch(`${s3Endpoint}/${bucket}/${(await location(id))!.key.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' })
    await nextCycle()
    expect(await check()).toEqual({ checked: 1, problems: 1 })
    expect(await location(id)).toMatchObject({ check_result: 'missing' })
  })
})
