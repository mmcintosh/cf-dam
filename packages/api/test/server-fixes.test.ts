/**
 * Review step 5, server side: pairing races, agent keys that outlive their approver, bounded bodies,
 * folders limited to what the agent offers, the pages' CSP, and two 500s.
 */
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addTags } from '../src/catalog/assets'
import { cleanRelativePath } from '../src/catalog/agents'
import { MIGRATIONS, migrate } from '../src/db/migrate'
import { securityHeaders } from '../src/lib/security-headers'
import { browserOrigins } from '../src/storage/connections'
import { bucketOrigin } from '../src/storage/s3'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

const agentFetch = (key: string, path: string, init: RequestInit = {}) =>
  h.fetch(path, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${key}` } })

async function start(): Promise<{ deviceCode: string; userCode: string }> {
  return (await (await h.fetch('/api/agent/pair/start', json({ name: 'NAS' }))).json()) as { deviceCode: string; userCode: string }
}

async function pair(): Promise<{ key: string; sourceId: string }> {
  const { deviceCode, userCode } = await start()
  expect((await h.fetch('/api/sources/pair', { ...json({ code: userCode }), cookie: admin })).status).toBe(201)
  const done = (await (await h.fetch('/api/agent/pair/poll', json({ deviceCode }))).json()) as { apiKey: string; sourceId: string }
  return { key: done.apiKey, sourceId: done.sourceId }
}

describe('pairing', () => {
  it('makes one agent when two people approve the same code at once', async () => {
    const { deviceCode, userCode } = await start()
    const both = await Promise.all([1, 2].map(() => h.fetch('/api/sources/pair', { ...json({ code: userCode }), cookie: admin })))
    // One wins; the other finds the code taken (404 if it looked after the claim, 409 if during).
    expect(both.map((r) => r.status).sort()).toEqual([201, expect.toSatisfy((s: number) => s === 404 || s === 409)])
    const sources = await h.env.DB.prepare('SELECT COUNT(*) AS n FROM sources').first<{ n: number }>()
    expect(sources!.n).toBe(1)
    expect(((await (await h.fetch('/api/agent/pair/poll', json({ deviceCode }))).json()) as { status: string }).status).toBe('approved')
  })

  it('keeps an approval made just before the code expired until the agent collects its key', async () => {
    const { deviceCode, userCode } = await start()
    // Approved with seconds to spare…
    await h.env.DB.prepare("UPDATE pairing_requests SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+2 seconds')").run()
    expect((await h.fetch('/api/sources/pair', { ...json({ code: userCode }), cookie: admin })).status).toBe(201)
    await new Promise((r) => setTimeout(r, 2500))
    // …another agent starting to pair purges expired requests; this one has been given time to collect.
    await start()
    expect(((await (await h.fetch('/api/agent/pair/poll', json({ deviceCode }))).json()) as { status: string }).status).toBe('approved')
  })
})

describe('an agent’s key', () => {
  it('belongs to the agent: not among the approver’s keys, alive when they are deactivated or deleted, dead when disconnected', async () => {
    const { key, sourceId } = await pair()
    const mine = (await (await h.fetch('/api/me/api-keys', { cookie: admin })).json()) as { keys: unknown[] }
    expect(mine.keys).toEqual([])
    const config = () => agentFetch(key, '/api/agent/config')
    expect((await config()).status).toBe(200)
    await h.env.DB.prepare('UPDATE users SET is_active = 0').run()
    expect((await config()).status).toBe(200)
    await h.env.DB.prepare('DELETE FROM users').run()
    expect((await config()).status).toBe(200)
    expect((await h.env.DB.prepare('SELECT created_by FROM sources WHERE id = ?').bind(sourceId).first<{ created_by: string | null }>())!.created_by).toBeNull()
    // Disconnecting (by anyone who manages agents) is what ends it.
    await h.env.DB.prepare("UPDATE sources SET revoked_at = '2026-01-01T00:00:00Z', key_hash = NULL").run()
    expect((await config()).status).toBe(401)
  })

  it('carries over from before 0020, when it was one of the approver’s API keys', async () => {
    const old = await createHarness({}, { migrations: MIGRATIONS.filter((m) => m.name < '0020') })
    try {
      await setUpAdmin(old)
      // As the code before 0020 did it: an api_keys row for the approver, named by the source.
      const userId = (await old.env.DB.prepare('SELECT id FROM users').first<{ id: string }>())!.id
      const { createApiKey } = await import('../src/auth/api-keys')
      const { key, record } = await createApiKey(old.env.DB, { userId, name: 'NAS agent: NAS', scopes: ['agent:sync'], expiresAt: null })
      await old.env.DB.batch([
        old.env.DB.prepare("INSERT INTO storage_connections (id, name, provider, auth_mode, storage_classes, default_class, is_default, created_at, updated_at) VALUES ('nas-s1', 'NAS', 'nas', 'agent', '[\"NAS\"]', 'NAS', 0, '2026-01-01', '2026-01-01')"),
        old.env.DB.prepare("INSERT INTO sources (id, name, connection_id, api_key_id, created_by, created_at) VALUES ('s1', 'NAS', 'nas-s1', ?, ?, '2026-01-01')").bind(record.id, userId),
      ])
      await migrate(old.env.DB, MIGRATIONS)
      expect((await old.fetch('/api/agent/config', { headers: { Authorization: `Bearer ${key}` } })).status).toBe(200)
      expect((await old.env.DB.prepare('SELECT COUNT(*) AS n FROM api_keys').first<{ n: number }>())!.n).toBe(0)
    } finally {
      await old.dispose()
    }
  })
})

describe('request bodies', () => {
  it('are bounded on the agent routes, the open pairing ones first', async () => {
    const big = await h.fetch('/api/agent/pair/start', json({ name: 'x'.repeat(10_000) }))
    expect(big.status).toBe(413)
    const { key } = await pair()
    const huge = new Uint8Array(5 * 1024 * 1024)
    const res = await agentFetch(key, '/api/agent/assets/x/renditions/thumb', { method: 'PUT', body: huge, headers: { 'Content-Type': 'image/webp' } })
    expect(res.status).toBe(413)
  })
})

describe('folders on a paired computer', () => {
  it('can only be ones the agent offers, or inside them', async () => {
    const { key, sourceId } = await pair()
    await agentFetch(key, '/api/agent/folders', json({ folders: ['/Volumes/Archive', 'C:/Users/me/Pictures'] }))
    const add = (path: string) => h.fetch(`/api/sources/${sourceId}/roots`, { ...json({ path }), cookie: admin })
    expect((await add('/Users')).status).toBe(400)
    expect((await add('C:/Users')).status).toBe(400)
    expect((await add('/Volumes/Archive2')).status).toBe(400)
    expect((await add('/Volumes/Archive/2014')).status).toBe(201)
    expect((await add('c:/users/me/pictures')).status).toBe(201) // Windows paths ignore case
  })

  it('name files by paths relative to them', () => {
    expect(cleanRelativePath('2023/IMG_1.jpg')).toBe('2023/IMG_1.jpg')
    for (const bad of ['', '/srv/x', 'C:/x', '//nas/x', '../x']) expect(() => cleanRelativePath(bad), bad).toThrow()
  })
})

describe('the pages’ content security policy', () => {
  it('lets the browser reach the configured buckets and nowhere else', async () => {
    expect(bucketOrigin({ endpoint: 'https://s3.eu-west-1.amazonaws.com', bucket: 'photos' })).toBe('https://photos.s3.eu-west-1.amazonaws.com')
    expect(bucketOrigin({ endpoint: 'http://localhost:9000', bucket: 'photos', forcePathStyle: true })).toBe('http://localhost:9000')
    await h.env.DB.prepare(
      `INSERT INTO storage_connections (id, name, provider, endpoint, region, bucket, prefix, force_path_style, auth_mode, storage_classes, default_class, is_default, created_at, updated_at)
       VALUES ('b2', 'B2', 's3', 'https://s3.us-west-004.backblazeb2.com', 'us-west-004', 'archive', '', 1, 'access-key', '["STANDARD"]', 'STANDARD', 0, '2026-01-01', '2026-01-01')`,
    ).run()
    const origins = await browserOrigins(h.env.DB)
    expect(origins).toEqual(['https://s3.us-west-004.backblazeb2.com'])

    const app = new Hono()
    app.use('*', securityHeaders(async () => origins))
    app.get('/page', (c) => c.html('<p>hi</p>'))
    app.get('/api', (c) => c.json({}))
    const csp = (await app.request('/page')).headers.get('Content-Security-Policy')!
    expect(csp).toContain("connect-src 'self' https://s3.us-west-004.backblazeb2.com;")
    expect(csp).toContain("media-src 'self' blob: https://s3.us-west-004.backblazeb2.com;")
    expect(csp).not.toMatch(/ https:;/)
    expect((await app.request('/api')).headers.get('Content-Security-Policy')).toContain("connect-src 'self';")
  })
})

describe('small server bugs', () => {
  it('removes an AI tag with % in it, and moves a keyword to the top level with parentId ""', async () => {
    const { key, sourceId } = await pair()
    await agentFetch(key, '/api/agent/folders', json({ folders: ['/photos'] }))
    const root = (await (await h.fetch(`/api/sources/${sourceId}/roots`, { ...json({ path: '/photos' }), cookie: admin })).json()) as { root: { id: string } }
    const sent = (await (await agentFetch(key, '/api/agent/assets/batch', json({ items: [{ root: root.root.id, path: 'a.jpg', size: 1, quickHash: 'a'.repeat(64) }] }))).json()) as { results: { assetId: string }[] }
    const id = sent.results[0]!.assetId
    await addTags(h.env.DB, id, ['100% cotton'], 'ai')
    const res = await h.fetch(`/api/assets/${id}/ai/tags/${encodeURIComponent('100% cotton')}`, { method: 'DELETE', cookie: admin })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { tags: unknown[] }).tags).toEqual([])

    const made = (await (await h.fetch('/api/tags', { ...json({ path: 'Places > Norway' }), cookie: admin })).json()) as { keyword: { id: string } }
    const moved = await h.fetch(`/api/tags/${made.keyword.id}`, { method: 'PATCH', body: JSON.stringify({ parentId: '' }), cookie: admin })
    expect(moved.status).toBe(200)
    const row = await h.env.DB.prepare('SELECT parent_id, path FROM tags WHERE id = ?').bind(made.keyword.id).first<{ parent_id: string | null; path: string }>()
    expect(row).toEqual({ parent_id: null, path: 'norway' })
  })
})
