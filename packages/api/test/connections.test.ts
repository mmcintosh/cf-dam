import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBackupConfig, DEFAULT_BACKUP_CONFIG } from '../src/catalog/backups'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

/** Just enough S3 for the connection test and the browser upload test, logging what it was asked. */
class FakeS3 {
  objects = new Set<string>()
  uploads = new Set<string>()
  log: string[] = []
  handle = async (input: Request | string, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const url = new URL(request.url)
    const key = decodeURIComponent(url.pathname.slice(1))
    const q = url.searchParams
    this.log.push(`${request.method} ${key}${q.has('uploads') ? '?uploads' : q.has('uploadId') ? '?uploadId' : ''}`)
    if (request.method === 'POST' && q.has('uploads')) {
      this.uploads.add('up-1')
      return new Response('<InitiateMultipartUploadResult><UploadId>up-1</UploadId></InitiateMultipartUploadResult>')
    }
    if (request.method === 'DELETE' && q.has('uploadId')) {
      this.uploads.delete(q.get('uploadId')!)
      return new Response(null, { status: 204 })
    }
    if (request.method === 'PUT') {
      this.objects.add(key)
      return new Response(null, { status: 200, headers: { ETag: '"e"' } })
    }
    if (request.method === 'HEAD') return this.objects.has(key) ? new Response(null, { headers: { 'Content-Length': '1', ETag: '"e"' } }) : new Response(null, { status: 404 })
    if (request.method === 'DELETE') {
      this.objects.delete(key)
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 400 })
  }
}

let h: Harness
let admin: string
let s3: FakeS3
let id: string
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  s3 = new FakeS3()
  vi.stubGlobal('fetch', s3.handle)
  const res = await h.fetch('/api/connections', {
    ...json({ name: 'Studio', endpoint: 'https://s3.eu-west-1.amazonaws.com', region: 'eu-west-1', bucket: 'studio', prefix: 'cf-dam', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET }),
    cookie: admin,
  })
  id = ((await res.json()) as { connection: { id: string } }).connection.id
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await h?.dispose()
})

const get = async <T>(path: string) => (await (await h.fetch(path, { cookie: admin })).json()) as T
const patch = (body: Record<string, unknown>) => h.fetch(`/api/connections/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, cookie: admin })
const now = () => new Date().toISOString()

async function photoOn(connectionId: string, storageClass: string, n: number): Promise<string> {
  const asset = `asset${connectionId.slice(0, 4)}${storageClass}${n}`.toLowerCase()
  await h.env.DB.batch([
    h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) VALUES (?, ?, 'image/jpeg', 1000, 'ready', ?, ?)").bind(asset, `${asset}.jpg`, now(), now()),
    h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, size, updated_at) VALUES (?, ?, ?, ?, 'present', 1000, ?)").bind(asset, connectionId, `cf-dam/originals/${asset}.jpg`, storageClass, now()),
  ])
  return asset
}

describe('a connection’s page (plans/PLAN-ST-v2.md)', () => {
  it('says what it keeps, by tier, and what uses it; the plain list says neither', async () => {
    const deep = await photoOn(id, 'DEEP_ARCHIVE', 1)
    await photoOn(id, 'STANDARD', 2)
    // A job archived here keeps its R2 copy: "here, hot" mustn't find it by that.
    await h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, size, updated_at) VALUES (?, 'r2', 'x', 'STANDARD', 'present', 1000, ?)").bind(deep, now()).run()
    await setBackupConfig(h.env.DB, { ...DEFAULT_BACKUP_CONFIG, connectionId: id })

    const details = await get<{ usage: { originals: number; bytes: number; tiers: Record<string, { count: number }> }; uses: { backupDestination: boolean; originals: number }; locked: boolean; backupHour: number | null }>(`/api/connections/${id}/details`)
    expect(details.usage).toMatchObject({ originals: 2, bytes: 2000, tiers: { deep: { count: 1 }, hot: { count: 1 } } })
    expect(details.uses).toMatchObject({ backupDestination: true, originals: 2 })
    expect(details.locked).toBe(true)
    expect(details.backupHour).toBe(DEFAULT_BACKUP_CONFIG.hour)

    const overview = await get<{ connections: { id: string; usage: { originals: number }; uses: { backupDestination: boolean } }[] }>('/api/connections/overview')
    expect(overview.connections.find((c) => c.id === id)).toMatchObject({ usage: { originals: 2 }, uses: { backupDestination: true } })
    const plain = await get<{ connections: Record<string, unknown>[] }>('/api/connections')
    expect(plain.connections[0]).not.toHaveProperty('usage')

    const ids = async (query: string) => (await get<{ assets: { id: string }[] }>(`/api/assets?${query}`)).assets.map((a) => a.id).sort()
    expect(await ids(`on=${id}&tier=hot`)).toEqual([`asset${id.slice(0, 4)}standard2`])
    expect(await ids(`on=${id}&tier=deep`)).toEqual([deep])
  })

  it('refuses to remove a connection something uses, and says what', async () => {
    await setBackupConfig(h.env.DB, { ...DEFAULT_BACKUP_CONFIG, connectionId: id })
    const refused = await h.fetch(`/api/connections/${id}`, { method: 'DELETE', cookie: admin })
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { uses: { backupDestination: boolean } }).uses.backupDestination).toBe(true)
    await setBackupConfig(h.env.DB, DEFAULT_BACKUP_CONFIG)
    expect((await h.fetch(`/api/connections/${id}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
  })

  it('changes its name, classes and keys at any time, but the bucket only while nothing uses it', async () => {
    expect((await patch({ name: 'Studio archive', bucket: 'studio-2', prefix: 'dam' })).status).toBe(200)
    await photoOn(id, 'STANDARD', 1)
    const locked = await patch({ bucket: 'elsewhere' })
    expect(locked.status).toBe(409)
    expect(((await locked.json()) as { error: string }).error).toBe('in_use')
    // The same value isn't a change.
    expect((await patch({ bucket: 'studio-2', name: 'Studio' })).status).toBe(200)

    const NEW_SECRET = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const res = await patch({ accessKeyId: 'AKIDNEW', secretAccessKey: NEW_SECRET, storageClasses: ['STANDARD', 'DEEP_ARCHIVE'], defaultClass: 'DEEP_ARCHIVE' })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).not.toContain(NEW_SECRET)
    const row = await h.env.DB.prepare('SELECT name, bucket, prefix, access_key_id, secret_sealed, storage_classes, default_class FROM storage_connections WHERE id = ?').bind(id).first<Record<string, string>>()
    expect(row).toMatchObject({ name: 'Studio', bucket: 'studio-2', prefix: 'dam', access_key_id: 'AKIDNEW', default_class: 'DEEP_ARCHIVE' })
    expect(row!.secret_sealed).not.toContain(NEW_SECRET)
    const log = await h.env.DB.prepare("SELECT details FROM activity_log WHERE action = 'storage.connection_changed'").all<{ details: string }>()
    expect(log.results).toHaveLength(3)
    expect(log.results.map((r) => r.details).join()).not.toContain(NEW_SECRET)
    // The new keys are the ones used.
    expect(await (await h.fetch(`/api/connections/${id}/test`, { method: 'POST', cookie: admin })).json()).toEqual({ ok: true })
    expect(s3.log.at(-1)).toBe('DELETE dam/.cf-dam-connection-test')

    // A class the job archive needs can't be dropped.
    await h.fetch('/api/archive/jobs', { method: 'PUT', body: JSON.stringify({ enabled: true, connectionId: id, storageClass: 'DEEP_ARCHIVE', afterDays: 30 }), headers: { 'Content-Type': 'application/json' }, cookie: admin })
    expect((await patch({ storageClasses: ['STANDARD'], defaultClass: 'STANDARD' })).status).toBe(409)
  })

  it('keeps the last test, and tests uploading from the browser without leaving anything behind', async () => {
    expect(await (await h.fetch(`/api/connections/${id}/test`, { method: 'POST', cookie: admin })).json()).toEqual({ ok: true })
    const tested = await get<{ connection: { lastTest: { ok: boolean } } }>(`/api/connections/${id}/details`)
    expect(tested.connection.lastTest.ok).toBe(true)

    const probe = (await (await h.fetch(`/api/connections/${id}/browser-test`, { method: 'POST', cookie: admin })).json()) as { url: string; token: string; uploadId: string }
    expect(new URL(probe.url).pathname).toBe(`/cf-dam/.cf-dam-browser-test/${probe.token}`)
    expect(new URL(probe.url).searchParams.get('partNumber')).toBe('1')
    expect(s3.uploads.size).toBe(1)
    // Only cf-dam's own probe key, from the token it handed out.
    const bad = await h.fetch(`/api/connections/${id}/browser-test/done`, { ...json({ token: '../../originals/x', uploadId: probe.uploadId }), cookie: admin })
    expect(bad.status).toBe(400)
    expect((await h.fetch(`/api/connections/${id}/browser-test/done`, { ...json({ token: probe.token, uploadId: probe.uploadId }), cookie: admin })).status).toBe(200)
    expect(s3.uploads.size).toBe(0)
    expect(s3.log.at(-1)).toBe(`DELETE cf-dam/.cf-dam-browser-test/${probe.token}?uploadId`)
  })
})
