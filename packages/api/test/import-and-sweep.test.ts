import { readFileSync } from 'node:fs'
import { AwsClient } from 'aws4fetch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSweep } from '../src/catalog/sweeper'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))
const s3Endpoint = process.env.S3_TEST_ENDPOINT
const credentials = { accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? '' }

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await h.dispose()
})

describe.skipIf(!s3Endpoint)('cataloguing an existing bucket in place', () => {
  it('imports what is there without copying, skips it the second time, and the sweep processes it', async () => {
    const bucket = `cfdam-import-${Date.now().toString(36)}`
    const client = new AwsClient({ ...credentials, service: 's3', region: 'us-east-1' })
    const put = (key: string, body: BodyInit) => client.fetch(`${s3Endpoint}/${bucket}/${key}`, { method: 'PUT', body })
    expect((await client.fetch(`${s3Endpoint}/${bucket}`, { method: 'PUT' })).ok).toBe(true)
    await put('photos/2019/Geiranger/IMG_0001.jpg', camera)
    await put('photos/2019/Geiranger/notes.txt', 'shot list')
    await put('photos/2019/empty-folder/', '')

    const created = await h.fetch('/api/connections', {
      ...json({ name: 'Old archive', endpoint: s3Endpoint, region: 'us-east-1', bucket, forcePathStyle: true, ...credentials }),
      cookie: admin,
    })
    const { connection } = (await created.json()) as { connection: { id: string } }

    const first = (await (await h.fetch(`/api/connections/${connection.id}/import`, { ...json({ prefix: 'photos/' }), cookie: admin })).json()) as Record<string, unknown>
    expect(first).toEqual({ listed: 3, imported: 2, skipped: 1, cursor: null })
    const again = (await (await h.fetch(`/api/connections/${connection.id}/import`, { ...json({ prefix: 'photos/' }), cookie: admin })).json()) as Record<string, unknown>
    expect(again).toMatchObject({ imported: 0, skipped: 3 })

    expect((await runSweep(h.env)).processed).toBe(2)
    const { assets } = (await (await h.fetch('/api/assets?q=IMG', { cookie: admin })).json()) as {
      assets: { filename: string; status: string; camera: { model: string }; renditions: string[]; storage: { connectionId: string } }[]
    }
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({ filename: 'IMG_0001.jpg', status: 'ready', camera: { model: 'Canon EOS R5' }, storage: { connectionId: connection.id } })
    expect(assets[0]!.renditions.sort()).toEqual(['preview', 'thumb'])
  })
})

describe('the sweep finishes restores', () => {
  it('marks an archived original restored once S3 reports the copy is ready', async () => {
    // A connection to AWS whose answers are stubbed: no network.
    const created = await h.fetch('/api/connections', {
      ...json({ name: 'AWS', endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'us-east-1', bucket: 'archive', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' }),
      cookie: admin,
    })
    const { connection } = (await created.json()) as { connection: { id: string; storageClasses: string[] } }
    expect(connection.storageClasses).toContain('DEEP_ARCHIVE')
    const now = new Date().toISOString()
    await h.env.DB.batch([
      h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) VALUES ('a1', 'old.cr3', 'image/x-canon-cr3', 10, 'ready', ?, ?)").bind(now, now),
      h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, updated_at) VALUES ('a1', ?, '2009/old.cr3', 'DEEP_ARCHIVE', 'restoring', ?)").bind(connection.id, now),
    ])

    vi.stubGlobal('fetch', async () =>
      new Response(null, {
        status: 200,
        headers: { 'Content-Length': '10', 'x-amz-storage-class': 'DEEP_ARCHIVE', 'x-amz-restore': 'ongoing-request="false", expiry-date="Fri, 30 Oct 2026 00:00:00 GMT"' },
      }),
    )
    expect(await runSweep(h.env)).toMatchObject({ restoresChecked: 1, restored: 1 })
    const location = await h.env.DB.prepare("SELECT state, restore_expires_at FROM asset_locations WHERE asset_id = 'a1'").first()
    expect(location).toEqual({ state: 'restored', restore_expires_at: '2026-10-30T00:00:00.000Z' })
  })

  /** An AWS connection with stubbed answers, and photos a1… with the given S3 locations. */
  async function archived(rows: { id: string; state: string; expires?: string; r2?: boolean }[]): Promise<string> {
    const created = await h.fetch('/api/connections', {
      ...json({ name: 'AWS', endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'us-east-1', bucket: 'archive', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' }),
      cookie: admin,
    })
    const { connection } = (await created.json()) as { connection: { id: string } }
    const now = new Date().toISOString()
    await h.env.DB.batch(
      rows.flatMap((r) => [
        h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) VALUES (?, 'old.cr3', 'image/x-canon-cr3', 10, 'ready', ?, ?)").bind(r.id, now, now),
        h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, restore_expires_at, updated_at) VALUES (?, ?, ?, 'DEEP_ARCHIVE', ?, ?, ?)").bind(r.id, connection.id, `2009/${r.id}.cr3`, r.state, r.expires ?? null, now),
        ...(r.r2 ? [h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, updated_at) VALUES (?, 'r2', ?, 'STANDARD', 'present', ?)").bind(r.id, `originals/${r.id}`, now)] : []),
      ]),
    )
    return connection.id
  }
  const row = (id: string) => h.env.DB.prepare("SELECT state, storage_class, restore_expires_at, next_check_at FROM asset_locations WHERE asset_id = ? AND connection_id != 'r2'").bind(id).first<{ state: string; storage_class: string; restore_expires_at: string | null; next_check_at: string | null }>()

  it('looks at a restore that is not ready again 20 minutes later, and settles gone or warm objects', async () => {
    await archived([{ id: 'slow', state: 'restoring' }, { id: 'gone', state: 'restoring' }, { id: 'warm', state: 'restoring' }])
    vi.stubGlobal('fetch', async (input: Request | string) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/gone.cr3')) return new Response(null, { status: 404 })
      if (url.includes('/warm.cr3')) return new Response(null, { status: 200, headers: { 'Content-Length': '10', 'x-amz-storage-class': 'STANDARD_IA' } })
      return new Response(null, { status: 200, headers: { 'Content-Length': '10', 'x-amz-storage-class': 'DEEP_ARCHIVE', 'x-amz-restore': 'ongoing-request="true"' } })
    })
    expect(await runSweep(h.env)).toMatchObject({ restoresChecked: 3, restored: 0 })
    const slow = (await row('slow'))!
    expect(slow.state).toBe('restoring')
    expect(Date.parse(slow.next_check_at!) - Date.now()).toBeGreaterThan(19 * 60_000)
    expect(await row('gone')).toMatchObject({ state: 'gone' })
    expect(await row('warm')).toMatchObject({ state: 'present', storage_class: 'STANDARD_IA' })
    // Not looked at again until its time comes.
    expect(await runSweep(h.env)).toMatchObject({ restoresChecked: 0 })
  })

  it('makes a restored copy cold again once its time is up', async () => {
    await archived([{ id: 'old', state: 'restored', expires: '2020-01-01T00:00:00.000Z' }, { id: 'fresh', state: 'restored', expires: '2099-01-01T00:00:00.000Z' }])
    await runSweep(h.env)
    expect(await row('old')).toMatchObject({ state: 'archived', restore_expires_at: null })
    expect(await row('fresh')).toMatchObject({ state: 'restored' })
    // An expired original isn't downloadable.
    expect((await h.fetch('/api/assets/old/original', { cookie: admin })).status).toBe(409)
  })

  it('restores the S3 copy of a photo that is also kept in R2', async () => {
    const connectionId = await archived([{ id: 'both', state: 'present', r2: true }])
    const asked: string[] = []
    vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      asked.push(`${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`)
      return new Response(null, { status: 202 })
    })
    const response = await h.fetch('/api/assets/both/restore', { ...json({ tier: 'Bulk', days: 3 }), cookie: admin })
    expect(response.status).toBe(202)
    expect(asked).toEqual([expect.stringMatching(/^POST .*2009\/both\.cr3\?restore/)])
    const s3 = await h.env.DB.prepare('SELECT state, next_check_at FROM asset_locations WHERE asset_id = ? AND connection_id = ?').bind('both', connectionId).first<{ state: string; next_check_at: string }>()
    expect(s3?.state).toBe('restoring')
    expect(s3?.next_check_at).toBeTruthy()
  })
})
