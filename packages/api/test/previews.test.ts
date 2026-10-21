import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkAlerts } from '../src/catalog/alerts'
import { checkStep, remakeStep, requestPreviews, startPreviewCheck } from '../src/catalog/previews'
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

/** An upload into the built-in R2, processed by the sweep: previews made. */
async function photo(filename: string): Promise<string> {
  const res = await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength, allowDuplicate: true }), cookie: admin })
  const { uploadId } = (await res.json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}
async function photos(n: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) ids.push(await photo(`IMG_${i}.jpg`))
  for (let i = 0; i < 5 && (await count("SELECT COUNT(*) AS n FROM assets WHERE status != 'ready'")) > 0; i++) await runSweep(h.env)
  return ids
}

const count = async (sql: string, ...binds: unknown[]) => (await h.env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n
const renditions = (id: string) => count('SELECT COUNT(*) AS n FROM renditions WHERE asset_id = ?', id)
const inR2 = async (id: string) => (await h.env.MEDIA_BUCKET!.list({ prefix: `renditions/${id}/` })).objects.length
const requests = async () =>
  (await h.env.DB.prepare('SELECT asset_id, route, source_id, attempts, error FROM preview_requests ORDER BY asset_id').all<{ asset_id: string; route: string; source_id: string | null; attempts: number; error: string | null }>()).results
const all = () => true

describe('missing previews', () => {
  it('are found by a check, made again from the original, and the check is logged', async () => {
    const [lost, kept] = await photos(2)
    expect(await renditions(lost!)).toBe(2)
    await h.env.MEDIA_BUCKET!.delete([`renditions/${lost}/thumb.webp`, `renditions/${lost}/preview.webp`])

    expect(await startPreviewCheck(h.env.DB)).toBe(true)
    expect(await startPreviewCheck(h.env.DB)).toBe(false)
    expect(await checkStep(h.env, all)).toBe(false)
    expect(await renditions(lost!)).toBe(0)
    expect(await renditions(kept!)).toBe(2)
    expect(await requests()).toEqual([expect.objectContaining({ asset_id: lost, route: 'worker' })])
    expect(await count("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'previews.checked'")).toBe(1)

    expect(await remakeStep(h.env, all)).toBe(1)
    expect(await renditions(lost!)).toBe(2)
    expect(await inR2(lost!)).toBe(2)
    expect(await requests()).toEqual([])
  }, 120_000)

  it('are all missing after a restore into an empty bucket, without asking R2 about each', async () => {
    const ids = await photos(2)
    const listed = await h.env.MEDIA_BUCKET!.list({ prefix: 'renditions/' })
    await h.env.MEDIA_BUCKET!.delete(listed.objects.map((o) => o.key))
    await startPreviewCheck(h.env.DB)
    // The sweep does it: the check, then the remaking.
    const busy = async () => (await count("SELECT COUNT(*) AS n FROM settings WHERE key = 'previews.check'")) + (await requests()).length > 0
    for (let i = 0; i < 6 && (await busy()); i++) await runSweep(h.env)
    for (const id of ids) expect(await inR2(id)).toBe(2)
    expect(await requests()).toEqual([])
  }, 120_000)

  it('are noticed when someone asks for one that is not there', async () => {
    const [id] = await photos(1)
    await h.env.MEDIA_BUCKET!.delete(`renditions/${id}/thumb.webp`)
    expect((await h.fetch(`/api/assets/${id}/renditions/thumb`, { cookie: admin })).status).toBe(404)
    expect(await count("SELECT COUNT(*) AS n FROM renditions WHERE asset_id = ? AND name = 'thumb'", id)).toBe(0)
    expect(await requests()).toEqual([expect.objectContaining({ asset_id: id, route: 'worker' })])
    await remakeStep(h.env, all)
    expect((await h.fetch(`/api/assets/${id}/renditions/thumb`, { cookie: admin })).status).toBe(200)
  }, 120_000)

  it('go to the agent for NAS photos, a batch a heartbeat, and wait for a restore when only archived', async () => {
    // An agent's photo, and one whose only copy is in Deep Archive.
    await h.env.DB.batch([
      h.env.DB.prepare("INSERT INTO storage_connections (id, name, provider, auth_mode, storage_classes, default_class, is_default, created_at, updated_at) VALUES ('nas-s1', 'NAS', 'nas', 'agent', '[\"NAS\"]', 'NAS', 0, 'x', 'x')"),
      h.env.DB.prepare("INSERT INTO sources (id, name, connection_id, key_hash, created_at) VALUES ('s1', 'Studio NAS', 'nas-s1', 'h', 'x')"),
      h.env.DB.prepare("INSERT INTO storage_connections (id, name, provider, endpoint, region, bucket, auth_mode, storage_classes, default_class, is_default, created_at, updated_at) VALUES ('aws', 'Glacier', 's3', 'https://s3.us-east-1.amazonaws.com', 'us-east-1', 'b', 'access-key', '[\"DEEP_ARCHIVE\"]', 'DEEP_ARCHIVE', 0, 'x', 'x')"),
      ...['nas-photo', 'cold-photo'].map((id) => h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) VALUES (?, ?, 'image/jpeg', 1, 'ready', 'x', 'x')").bind(id, `${id}.jpg`)),
      h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, updated_at) VALUES ('nas-photo', 'nas-s1', '/photos/a.jpg', 'NAS', 'present', 'x')"),
      h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, updated_at) VALUES ('cold-photo', 'aws', 'a.jpg', 'DEEP_ARCHIVE', 'present', 'x')"),
    ])
    await requestPreviews(h.env.DB, ['nas-photo', 'cold-photo'])
    expect(await requests()).toEqual([
      expect.objectContaining({ asset_id: 'cold-photo', route: 'archived', source_id: null }),
      expect.objectContaining({ asset_id: 'nas-photo', route: 'agent', source_id: 's1' }),
    ])
    // Stuck ones raise an alert.
    await checkAlerts(h.env)
    expect(await count("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'previews.stuck' AND resolved_at IS NULL")).toBe(1)

    const { heartbeat } = await import('../src/catalog/agents')
    const source = (await h.env.DB.prepare("SELECT * FROM sources WHERE id = 's1'").first())!
    const first = await heartbeat(h.env.DB, source as never, { status: {} })
    expect(first).toEqual({ paused: false, rescan: true, resend: ['nas-photo'] })
    // Asked once a day, not every minute.
    expect(await heartbeat(h.env.DB, source as never, { status: {} })).toEqual({ paused: false, rescan: false })

    // Its previews arrive: the request is tidied away.
    await h.env.DB.prepare("INSERT INTO renditions (asset_id, name, key, mime_type, size, source, created_at) VALUES ('nas-photo', 'thumb', 'k', 'image/webp', 1, 'agent', 'x'), ('nas-photo', 'preview', 'k2', 'image/webp', 1, 'agent', 'x')").run()
    await remakeStep(h.env, all)
    expect((await requests()).map((r) => r.asset_id)).toEqual(['cold-photo'])
  }, 120_000)

  it('show on the Storage page, for those who manage storage', async () => {
    await photos(1)
    const started = await h.fetch('/api/previews/check', { method: 'POST', cookie: admin })
    expect(started.status).toBe(202)
    expect(((await started.json()) as { check: unknown }).check).not.toBeNull()
    expect((await h.fetch('/api/previews/check', { method: 'POST', cookie: admin })).status).toBe(409)
    const status = (await (await h.fetch('/api/previews', { cookie: admin })).json()) as { waiting: Record<string, number> }
    expect(status.waiting).toEqual({ agent: 0, worker: 0, archived: 0, unreadable: 0 })
  }, 120_000)
})
