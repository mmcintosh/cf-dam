import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { albumStorage, askRestores } from '../src/catalog/job-storage'
import { runSweep } from '../src/catalog/sweeper'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

let h: Harness
let admin: string
let ids: string[]
let jobId: string
let albumId: string
let s3: string

async function upload(filename: string): Promise<string> {
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  ids = [await upload('hot.jpg'), await upload('cold.jpg'), await upload('both.jpg'), await upload('nas.jpg')]
  const client = ((await (await h.fetch('/api/clients', { ...json({ name: 'Hansen' }), cookie: admin })).json()) as { client: { id: string } }).client.id
  const job = (await (await h.fetch('/api/jobs', { ...json({ clientId: client, title: 'Hansen wedding', stage: 'delivered' }), cookie: admin })).json()) as { job: { id: string } }
  jobId = job.job.id
  albumId = ((await (await h.fetch('/api/albums', { ...json({ name: 'Selects' }), cookie: admin })).json()) as { album: { id: string } }).album.id
  await h.fetch(`/api/albums/${albumId}/items`, { ...json({ assetIds: ids }), cookie: admin })
  await h.fetch(`/api/jobs/${jobId}/albums`, { ...json({ albumId }), cookie: admin })
  // An AWS connection whose answers are stubbed, and a NAS.
  s3 = ((await (await h.fetch('/api/connections', {
    ...json({ name: 'AWS', endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'us-east-1', bucket: 'archive', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' }),
    cookie: admin,
  })).json()) as { connection: { id: string } }).connection.id
  const now = new Date().toISOString()
  const cold = (assetId: string) => h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, size, updated_at) VALUES (?, ?, ?, 'DEEP_ARCHIVE', 'present', 1048576, ?)").bind(assetId, s3, `originals/${assetId}`, now)
  await h.env.DB.batch([
    // cold.jpg: only in Deep Archive. both.jpg: R2 and Deep Archive. nas.jpg: only on a NAS.
    h.env.DB.prepare("DELETE FROM asset_locations WHERE asset_id IN (?, ?)").bind(ids[1], ids[3]),
    cold(ids[1]!),
    cold(ids[2]!),
    h.env.DB.prepare("INSERT INTO storage_connections (id, name, provider, auth_mode, storage_classes, default_class, is_default, created_at, updated_at) VALUES ('nas-1', 'NAS', 'nas', 'agent', '[\"NAS\"]', 'NAS', 0, ?, ?)").bind(now, now),
    h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, updated_at) VALUES (?, 'nas-1', 'Photos/nas.jpg', 'NAS', 'present', ?)").bind(ids[3], now),
  ])
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await h.dispose()
})

const storage = async () => (await (await h.fetch(`/api/jobs/${jobId}/storage`, { cookie: admin })).json()) as { storage: Record<string, number>; restore: Record<string, unknown> | null }

describe('storage per job', () => {
  it('tells readable now, needs a restore, NAS only and cold backup apart', async () => {
    expect((await storage()).storage).toEqual({ photos: 4, readable: 3, offerable: 2, nasOnly: 1, needsRestore: 1, restoring: 0, restoreBytes: 1048576, coldBackup: 2 })
    expect(await albumStorage(h.env.DB, albumId)).toMatchObject({ needsRestore: 1, nasOnly: 1 })
    const estimate = (await (await h.fetch(`/api/jobs/${jobId}/restore-estimate?tier=Bulk&days=7`, { cookie: admin })).json()) as { estimate: { photos: number; bytes: number; retrieval: number; hours: number[] } }
    expect(estimate.estimate).toMatchObject({ photos: 1, bytes: 1048576, hours: [12, 48] })
    expect(estimate.estimate.retrieval).toBeGreaterThan(0)
    expect((await h.fetch(`/api/jobs/${jobId}/restore-estimate?tier=Expedited`, { cookie: admin })).status).toBe(400)
  })

  it('restores a job: asks S3 through the queue, then counts it ready once restored', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      asked.push(`${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`)
      return new Response(null, { status: 202 })
    })
    const started = await h.fetch(`/api/jobs/${jobId}/restore`, { ...json({ tier: 'Bulk', days: 3 }), cookie: admin })
    expect(started.status).toBe(202)
    expect(await askRestores(h.env, 20)).toBe(1)
    // Only the photo with nothing readable is asked for: not the one also in R2.
    expect(asked).toEqual([expect.stringMatching(new RegExp(`^POST .*originals/${ids[1]}\\?restore`))])
    expect((await storage()).storage).toMatchObject({ needsRestore: 1, restoring: 1 })
    expect((await storage()).restore).toMatchObject({ photos: 1, asked: 1, ready: 0, waiting: 0 })
    // Nothing more to restore while it's on its way.
    expect((await h.fetch(`/api/jobs/${jobId}/restore`, { ...json({ tier: 'Bulk' }), cookie: admin })).status).toBe(409)

    // S3 reports the copy ready: the sweep's check marks it, and the job counts it.
    vi.stubGlobal('fetch', async () =>
      new Response(null, { status: 200, headers: { 'Content-Length': '1048576', 'x-amz-storage-class': 'DEEP_ARCHIVE', 'x-amz-restore': 'ongoing-request="false", expiry-date="Fri, 30 Oct 2099 00:00:00 GMT"' } }),
    )
    await h.env.DB.prepare('UPDATE asset_locations SET next_check_at = NULL WHERE asset_id = ?').bind(ids[1]).run()
    await runSweep(h.env)
    expect((await storage()).storage).toMatchObject({ readable: 4, needsRestore: 0 })
    expect((await storage()).restore).toMatchObject({ ready: 1, readyUntil: '2099-10-30T00:00:00.000Z' })
  })

  it('gives up on an item after three failed asks', async () => {
    vi.stubGlobal('fetch', async () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }))
    expect((await h.fetch(`/api/jobs/${jobId}/restore`, { ...json({ tier: 'Standard' }), cookie: admin })).status).toBe(202)
    for (let i = 0; i < 3; i++) await askRestores(h.env, 20)
    expect((await storage()).restore).toMatchObject({ failed: 1, waiting: 0 })
  })
})
