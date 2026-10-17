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
})
