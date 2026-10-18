import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanAgentPath, keyOf } from '../src/catalog/agents'
import { decodePng, hashPixels } from '../src/catalog/phash'
import { runSweep } from '../src/catalog/sweeper'
import { cookiesFrom, createHarness, json, setUpAdmin, signIn, type Harness } from './harness'

const placesGz = readFileSync(new URL('../../../public/places/cities1000.tsv.gz', import.meta.url))
const ASSETS = { fetch: async () => new Response(placesGz) } as unknown as Fetcher

let h: Harness
let admin: string

/** A stand-in AI binding, to check what gets queued (nothing runs here). */
const AI = { run: async () => ({ response: '{}' }) } as unknown as Ai

beforeEach(async () => {
  h = await createHarness({ ASSETS, AI })
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

const agentFetch = (key: string, path: string, init: RequestInit = {}) =>
  h.fetch(path, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${key}` } })

/** Pair an agent the way a person and an agent would, and return its key and source id. */
async function pair(name = 'Studio NAS'): Promise<{ key: string; sourceId: string }> {
  const start = await h.fetch('/api/agent/pair/start', json({ name, platform: 'linux/amd64', version: '1.0.0' }))
  expect(start.status).toBe(201)
  const { deviceCode, userCode } = (await start.json()) as { deviceCode: string; userCode: string }
  expect((await h.fetch('/api/agent/pair/poll', json({ deviceCode }))).status).toBe(202)
  const preview = (await (await h.fetch(`/api/sources/pair/${userCode.toLowerCase()}`, { cookie: admin })).json()) as { name: string }
  expect(preview.name).toBe(name)
  expect((await h.fetch('/api/sources/pair', { ...json({ code: userCode }), cookie: admin })).status).toBe(201)
  const done = (await (await h.fetch('/api/agent/pair/poll', json({ deviceCode }))).json()) as { status: string; apiKey: string; sourceId: string }
  expect(done.status).toBe('approved')
  // The key is handed over once.
  expect((await h.fetch('/api/agent/pair/poll', json({ deviceCode }))).status).toBe(410)
  // What the agent offers; folders can only be chosen from it.
  await agentFetch(done.apiKey, '/api/agent/folders', json({ folders: ['/photos'] }))
  return { key: done.apiKey, sourceId: done.sourceId }
}

async function addRoot(sourceId: string, path = '/photos/photo'): Promise<string> {
  const res = await h.fetch(`/api/sources/${sourceId}/roots`, { ...json({ path, label: 'Photo' }), cookie: admin })
  return ((await res.json()) as { root: { id: string } }).root.id
}

const hex = (seed: string) => [...seed.padEnd(64, '0')].map((c) => (c.charCodeAt(0) % 16).toString(16)).join('').slice(0, 64)

async function renditions(color: { r: number; g: number; b: number }) {
  const base = sharp({ create: { width: 3000, height: 2000, channels: 3, background: color } }).composite([
    { input: Buffer.from('<svg width="3000" height="2000"><rect x="300" y="300" width="1200" height="900" fill="#fff"/></svg>') },
  ])
  const big = await base.png().toBuffer()
  const preview = new Uint8Array(await sharp(big).resize(2048, 2048, { fit: 'inside' }).webp({ effort: 2 }).toBuffer())
  const thumb = new Uint8Array(await sharp(big).resize(480, 480, { fit: 'inside' }).webp({ effort: 2 }).toBuffer())
  const phash = hashPixels(await decodePng(new Uint8Array(await sharp(thumb).png().toBuffer())))
  return { preview, thumb, phash }
}

async function send(key: string, items: unknown[]) {
  const res = await agentFetch(key, '/api/agent/assets/batch', json({ items }))
  return { status: res.status, body: (await res.json()) as { results: { path: string; assetId: string; result: string; needs: string[]; error?: string }[] } }
}

async function upload(key: string, assetId: string, color = { r: 30, g: 90, b: 160 }) {
  const r = await renditions(color)
  for (const [name, bytes] of [['thumb', r.thumb], ['preview', r.preview]] as const) {
    const res = await agentFetch(key, `/api/agent/assets/${assetId}/renditions/${name}`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'image/webp' } })
    expect(res.status).toBe(200)
  }
  return r.phash
}

const asset = async (id: string) =>
  (await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as {
    filename: string
    status: string
    width: number
    tags: { path: string }[]
    iptc: Record<string, string | null>
    ai: { status: string | null }
    locations: { connectionId: string; storageClass: string; state: string }[]
  }

describe('pairing', () => {
  it('pairs only with a person’s approval, and refuses unknown codes and people without the right', async () => {
    const start = (await (await h.fetch('/api/agent/pair/start', json({ name: 'NAS' }))).json()) as { userCode: string; verificationUrl: string }
    expect(start.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(start.verificationUrl).toBe('http://localhost/sources')
    expect((await h.fetch('/api/sources/pair', { ...json({ code: 'AAAA-BBBB' }), cookie: admin })).status).toBe(404)
    await h.fetch('/api/users', { ...json({ name: 'E', email: 'e@example.com', password: 'editor password 1', roles: ['editor'] }), cookie: admin })
    const editor = cookiesFrom(await signIn(h, 'e@example.com', 'editor password 1'))
    expect((await h.fetch('/api/sources/pair', { ...json({ code: start.userCode }), cookie: editor })).status).toBe(403)
    expect((await h.fetch('/api/agent/pair/poll', json({ deviceCode: 'nope' }))).status).toBe(410)
  })

  it('gives the agent a key that can only sync, and a person’s key can’t act as an agent', async () => {
    const { key } = await pair()
    expect((await agentFetch(key, '/api/agent/config')).status).toBe(200)
    expect((await agentFetch(key, '/api/assets')).status).toBe(403)
    expect((await agentFetch(key, '/api/users')).status).toBe(403)
    // People can't grant agent:sync to their own keys, and a full key still can't act as an agent.
    expect((await h.fetch('/api/me/api-keys', { ...json({ name: 'sneaky', scopes: ['agent:sync'] }), cookie: admin })).status).toBe(400)
    const created = (await (await h.fetch('/api/me/api-keys', { ...json({ name: 'script', scopes: ['assets:read', 'assets:edit'] }), cookie: admin })).json()) as { key: string }
    expect(created.key).toMatch(/^cfdam_/)
    expect((await agentFetch(created.key, '/api/agent/config')).status).toBe(403)
    // NAS connections stay out of the storage page and uploads.
    const connections = (await (await h.fetch('/api/connections', { cookie: admin })).json()) as { connections: { provider: string }[] }
    expect(connections.connections.map((c) => c.provider)).toEqual(['r2-binding'])
  })
})

describe('folders and files', () => {
  it('indexes files in place: metadata, previews, place, tier, and the original stays put', async () => {
    const { key, sourceId } = await pair()
    expect((await h.fetch(`/api/sources/${sourceId}/roots`, { ...json({ path: '/photos/../etc' }), cookie: admin })).status).toBe(400)
    const root = await addRoot(sourceId)
    expect((await h.fetch(`/api/sources/${sourceId}/roots`, { ...json({ path: '/photos/photo/2019' }), cookie: admin })).status).toBe(409)
    expect(await (await agentFetch(key, '/api/agent/folders', json({ folders: ['/photos/photo', '/photos/video'] }))).json()).toEqual({ folders: 2 })
    const config = (await (await agentFetch(key, '/api/agent/config')).json()) as { roots: { id: string; path: string }[]; defaultExcludes: string[] }
    expect(config.roots).toEqual([expect.objectContaining({ id: root, path: '/photos/photo' })])
    expect(config.defaultExcludes).toContain('@eaDir')

    const { body } = await send(key, [
      {
        root,
        path: '2019/Bergen/IMG_2041.CR3',
        size: 31_457_280,
        mtime: '2019-06-01T10:00:00Z',
        quickHash: hex('a'),
        metadata: {
          width: 6000, height: 4000, capturedAt: '2019-06-01T09:58:12', cameraMake: 'Canon', cameraModel: 'Canon EOS R5',
          gpsLat: 60.3971, gpsLng: 5.3245, keywords: ['Places|Norway|Bergen'], iptc: { creator: 'Mark' }, rating: 4,
        },
      },
      { root, path: '../../etc/passwd', size: 1, quickHash: hex('b') },
      { root: 'nope', path: 'x.jpg', size: 1, quickHash: hex('c') },
    ])
    expect(body.results.map((r) => r.result)).toEqual(['created', 'rejected', 'rejected'])
    const id = body.results[0]!.assetId
    expect(body.results[0]!.needs).toEqual(['thumb', 'preview'])

    // Renditions: WebP of the right size only.
    expect((await agentFetch(key, `/api/agent/assets/${id}/renditions/thumb`, { method: 'PUT', body: new Uint8Array([1, 2, 3]) })).status).toBe(400)
    const tooBig = new Uint8Array(await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#888' } }).webp().toBuffer())
    expect((await agentFetch(key, `/api/agent/assets/${id}/renditions/thumb`, { method: 'PUT', body: tooBig })).status).toBe(400)
    const phash = await upload(key, id)
    const done = await agentFetch(key, '/api/agent/assets/complete', json({ items: [{ id, phash }] }))
    expect(await done.json()).toEqual({ results: [{ id, status: 'ready' }] })

    const a = await asset(id)
    expect(a).toMatchObject({ filename: 'IMG_2041.CR3', status: 'ready', width: 6000 })
    expect(a.tags.map((t) => t.path)).toEqual(['Places › Norway › Bergen'])
    expect(a.iptc).toMatchObject({ creator: 'Mark', city: 'Bergen', country: 'Norway' })
    expect(a.locations).toEqual([expect.objectContaining({ storageClass: 'NAS', state: 'present' })])
    // First import of a folder: AI review waits for a person to start it.
    expect(a.ai.status).toBeNull()
    expect(((await (await h.fetch('/api/assets?tier=nas', { cookie: admin })).json()) as { total: number }).total).toBe(1)
    // The Worker never reads a NAS original.
    expect((await h.fetch(`/api/assets/${id}/original`, { cookie: admin })).status).toBe(409)
  })

  it('recognises unchanged, changed, renamed and missing files, and queues AI after the first scan', async () => {
    const { key, sourceId } = await pair()
    const root = await addRoot(sourceId)
    const first = await send(key, [
      { root, path: 'a.jpg', size: 100, quickHash: hex('a') },
      { root, path: 'b.jpg', size: 200, quickHash: hex('b') },
      { root, path: 'c.jpg', size: 300, quickHash: hex('c') },
    ])
    const [a, b, c] = first.body.results.map((r) => r.assetId)
    for (const id of [a!, b!, c!]) await upload(key, id)
    await agentFetch(key, '/api/agent/assets/complete', json({ items: [{ id: a }, { id: b }, { id: c }] }))
    expect(await (await agentFetch(key, '/api/agent/scans/complete', json({ root }))).json()).toEqual({ missing: 0 })

    // Second scan: a unchanged, b edited, c renamed (the agent knows), d new.
    const again = await send(key, [
      { root, path: 'a.jpg', size: 100, quickHash: hex('a') },
      { root, path: 'b.jpg', size: 250, quickHash: hex('B') },
      { root, path: 'renamed/c.jpg', size: 300, quickHash: hex('c'), previousPath: 'c.jpg' },
      { root, path: 'd.jpg', size: 400, quickHash: hex('d') },
    ])
    expect(again.body.results.map((r) => [r.result, r.needs])).toEqual([
      ['unchanged', []],
      ['updated', ['thumb', 'preview']],
      ['moved', []],
      ['created', ['thumb', 'preview']],
    ])
    expect(again.body.results[2]!.assetId).toBe(c)
    expect((await asset(c!)).filename).toBe('c.jpg')
    const d = again.body.results[3]!.assetId
    await upload(key, d)
    await agentFetch(key, '/api/agent/assets/complete', json({ items: [{ id: d }] }))
    // New photos after the first scan follow "analyse new uploads".
    expect((await asset(d)).ai.status).toBe('queued')

    // Third scan: b and c are gone (the agent lists them); they're marked missing, not deleted.
    expect(await (await agentFetch(key, '/api/agent/scans/complete', json({ root, missing: ['b.jpg', 'renamed/c.jpg', 'never-was.jpg'] }))).json()).toEqual({ missing: 2 })
    expect((await asset(b!)).locations[0]!.state).toBe('missing')
    expect((await agentFetch(key, '/api/agent/scans/complete', json({ root, missing: ['../x'] }))).status).toBe(400)
    const count = async (q: string) => ((await (await h.fetch(`/api/assets?${q}`, { cookie: admin })).json()) as { total: number }).total
    expect(await count('missing=1')).toBe(2)
    expect(await count(`on=nas-${sourceId}`)).toBe(4)
    expect(await count('on=r2')).toBe(0)

    // c turns up elsewhere without the agent knowing where it was: matched by fingerprint.
    const found = await send(key, [{ root, path: 'archive/c-copy.jpg', size: 300, quickHash: hex('c') }])
    expect(found.body.results[0]).toMatchObject({ result: 'moved', assetId: c })
    expect((await asset(c!)).locations[0]!.state).toBe('present')
  })

  it('never gives a deleted photo’s entry to a new file saved under its name, and keeps one photo per path', async () => {
    const { key, sourceId } = await pair()
    const root = await addRoot(sourceId)
    const first = await send(key, [{ root, path: 'a.jpg', size: 100, quickHash: hex('a'), metadata: { width: 6000, height: 4000, capturedAt: '2019-06-01T09:58:12', title: 'Fjord' } }])
    const old = first.body.results[0]!.assetId
    await upload(key, old)
    await agentFetch(key, '/api/agent/assets/complete', json({ items: [{ id: old }] }))
    await agentFetch(key, '/api/agent/scans/complete', json({ root, missing: ['a.jpg'] }))

    // A different photo, saved as a.jpg: a new entry. The old one stays, still missing, still itself.
    const other = await send(key, [{ root, path: 'a.jpg', size: 200, quickHash: hex('z'), metadata: { width: 4000, height: 3000, capturedAt: '2024-01-01T10:00:00' } }])
    expect(other.body.results[0]).toMatchObject({ result: 'created', ready: false })
    const fresh = other.body.results[0]!.assetId
    expect(fresh).not.toBe(old)
    const was = (await (await h.fetch(`/api/assets/${old}`, { cookie: admin })).json()) as { title: string; width: number; locations: { state: string }[] }
    expect(was).toMatchObject({ title: 'Fjord', width: 6000, locations: [expect.objectContaining({ state: 'missing' })] })

    // The same new file sent twice at once: one photo.
    const twice = await Promise.all([1, 2].map(() => send(key, [{ root, path: 'b.jpg', size: 300, quickHash: hex('b') }])))
    expect(new Set(twice.map((t) => t.body.results[0]!.assetId)).size).toBe(1)
    await h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) VALUES ('dup', 'b.jpg', 'image/jpeg', 1, 'ready', 'x', 'x')").run()
    const duplicate = h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, updated_at) VALUES ('dup', ?, '/photos/photo/b.jpg', 'NAS', 'present', 'x')").bind(`nas-${sourceId}`)
    await expect(duplicate.run()).rejects.toThrow(/UNIQUE/)

    // The original a.jpg's file is back (a share that dropped): it is that photo again, present.
    await agentFetch(key, '/api/agent/scans/complete', json({ root, missing: ['a.jpg'] }))
    const back = await send(key, [{ root, path: 'a.jpg', size: 100, quickHash: hex('a') }])
    expect(back.body.results[0]).toMatchObject({ result: 'unchanged', assetId: old, ready: true, needs: [] })
    expect((await asset(old)).locations[0]!.state).toBe('present')
  })

  it('replaces what a re-saved file says about itself, and keeps what people wrote', async () => {
    const { key, sourceId } = await pair()
    const root = await addRoot(sourceId)
    const sent = await send(key, [{ root, path: 'a.jpg', size: 100, quickHash: hex('a'), metadata: { width: 6000, height: 4000, capturedAt: '2019-06-01T09:58:12', gpsLat: 60.39, gpsLng: 5.32, title: 'From the file' } }])
    const id = sent.body.results[0]!.assetId
    await upload(key, id)
    await agentFetch(key, '/api/agent/assets/complete', json({ items: [{ id }] }))
    await h.fetch(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Mine' }), cookie: admin })
    // Cropped and re-exported, with the date corrected.
    const changed = await send(key, [{ root, path: 'a.jpg', size: 90, quickHash: hex('A'), metadata: { width: 3000, height: 2000, capturedAt: '2019-06-02T09:58:12', gpsLat: 59.91, gpsLng: 10.75, title: 'Retitled in the file' } }])
    expect(changed.body.results[0]).toMatchObject({ result: 'updated', needs: ['thumb', 'preview'] })
    const a = (await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as { width: number; capturedAt: string; title: string; gps: { lat: number } | null; status: string }
    expect(a).toMatchObject({ width: 3000, title: 'Mine', status: 'processing' })
    expect(a.capturedAt).toContain('2019-06-02')
    expect(a.gps?.lat).toBeCloseTo(59.91)
  })

  it('knows a file moved between two folders, and finishes photos an agent left half-sent', async () => {
    const { key, sourceId } = await pair()
    const one = await addRoot(sourceId, '/photos/one')
    const two = await addRoot(sourceId, '/photos/two')
    const sent = await send(key, [{ root: one, path: 'x.jpg', size: 100, quickHash: hex('x') }])
    const id = sent.body.results[0]!.assetId
    await upload(key, id)
    await agentFetch(key, '/api/agent/assets/complete', json({ items: [{ id }] }))
    const moved = await send(key, [{ root: two, path: 'sorted/x.jpg', size: 100, quickHash: hex('x'), previousRoot: one, previousPath: 'x.jpg' }])
    expect(moved.body.results[0]).toMatchObject({ result: 'moved', assetId: id, ready: true, needs: [] })
    // Another agent's folder can't be named as where a file was.
    const other = await pair('Other NAS')
    const theirs = await addRoot(other.sourceId, '/photos/three')
    expect((await send(key, [{ root: two, path: 'y.jpg', size: 1, quickHash: hex('y'), previousRoot: theirs, previousPath: 'y.jpg' }])).body.results[0]!.result).toBe('rejected')

    // An agent that sent a photo and stopped before finishing it: sent again, it's "not ready" and
    // gets finished; never sent again, the sweep finishes it after an hour.
    const half = (await send(key, [{ root: one, path: 'h.jpg', size: 5, quickHash: hex('h') }])).body.results[0]!.assetId
    await upload(key, half)
    expect((await send(key, [{ root: one, path: 'h.jpg', size: 5, quickHash: hex('h') }])).body.results[0]).toMatchObject({ result: 'unchanged', ready: false, needs: [] })
    const lost = (await send(key, [{ root: one, path: 'l.jpg', size: 6, quickHash: hex('l') }])).body.results[0]!.assetId
    await h.env.DB.prepare("UPDATE assets SET updated_at = '2020-01-01T00:00:00Z' WHERE id IN (?, ?)").bind(half, lost).run()
    expect((await runSweep(h.env)).recovered).toBe(2)
    expect((await asset(half)).status).toBe('ready')
    expect((await asset(lost)).status).toBe('ready')
  })

  it('stops while paused, cannot touch other photos, and is cut off when revoked', async () => {
    const { key, sourceId } = await pair()
    const root = await addRoot(sourceId)
    // A photo uploaded through the browser is not the agent's.
    const up = (await (await h.fetch('/api/uploads', { ...json({ filename: 'x.jpg', size: 3 }), cookie: admin })).json()) as { assetId: string }
    const thumb = (await renditions({ r: 1, g: 2, b: 3 })).thumb
    expect((await agentFetch(key, `/api/agent/assets/${up.assetId}/renditions/thumb`, { method: 'PUT', body: thumb })).status).toBe(404)

    await h.fetch(`/api/sources/${sourceId}`, { method: 'PATCH', body: JSON.stringify({ paused: true }), cookie: admin })
    expect((await send(key, [{ root, path: 'a.jpg', size: 1, quickHash: hex('a') }])).status).toBe(409)
    expect(await (await agentFetch(key, '/api/agent/heartbeat', json({ version: '1.0.1', status: { seen: 10 } }))).json()).toEqual({ paused: true, rescan: false })
    await h.fetch(`/api/sources/${sourceId}/rescan`, { method: 'POST', cookie: admin })
    expect(await (await agentFetch(key, '/api/agent/heartbeat', json({}))).json()).toEqual({ paused: true, rescan: true })
    expect(await (await agentFetch(key, '/api/agent/heartbeat', json({}))).json()).toEqual({ paused: true, rescan: false })

    const list = (await (await h.fetch('/api/sources', { cookie: admin })).json()) as { sources: { name: string; online: boolean; version: string; status: { seen: number } }[] }
    expect(list.sources[0]).toMatchObject({ name: 'Studio NAS', online: true, version: '1.0.1' })

    expect((await h.fetch(`/api/sources/${sourceId}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    expect((await agentFetch(key, '/api/agent/config')).status).toBe(401)
  })

  it('indexes videos: length, codec and frame rate, a poster, and a contact sheet', async () => {
    const { key, sourceId } = await pair()
    const root = await addRoot(sourceId)
    const { body } = await send(key, [
      { root, path: 'clips/boat.mov', size: 5_000_000, quickHash: hex('v'), metadata: { width: 3840, height: 2160, orientation: 6, video: { duration: 31.5, codec: 'hevc', frameRate: 29.97 } } },
    ])
    const id = body.results[0]!.assetId
    await upload(key, id)
    const sheet = new Uint8Array(await sharp({ create: { width: 960, height: 540, channels: 3, background: '#123' } }).webp().toBuffer())
    expect((await agentFetch(key, `/api/agent/assets/${id}/renditions/sheet`, { method: 'PUT', body: sheet })).status).toBe(200)
    const tooBig = new Uint8Array(await sharp({ create: { width: 1200, height: 675, channels: 3, background: '#123' } }).webp().toBuffer())
    expect((await agentFetch(key, `/api/agent/assets/${id}/renditions/sheet`, { method: 'PUT', body: tooBig })).status).toBe(400)
    await agentFetch(key, '/api/agent/assets/complete', json({ items: [{ id }] }))
    const a = (await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as { mimeType: string; width: number; height: number; renditions: string[]; video: unknown }
    expect(a).toMatchObject({ mimeType: 'video/quicktime', width: 2160, height: 3840, video: { duration: 31.5, codec: 'hevc', frameRate: 29.97 } })
    expect(a.renditions.sort()).toEqual(['preview', 'sheet', 'thumb'])
    expect((await h.fetch(`/api/assets/${id}/renditions/sheet`, { cookie: admin })).headers.get('content-type')).toBe('image/webp')
    expect(((await (await h.fetch('/api/assets?type=video', { cookie: admin })).json()) as { total: number }).total).toBe(1)
  })

  it('understands Windows drives and network shares, and folders that go offline', async () => {
    expect(cleanAgentPath('e:/Photos/2014')).toBe('E:/Photos/2014')
    expect(cleanAgentPath('E:/')).toBe('E:/')
    expect(cleanAgentPath('//nas/photo/2019')).toBe('//nas/photo/2019')
    expect(() => cleanAgentPath('//nas')).toThrow()
    expect(() => cleanAgentPath('E:/../x')).toThrow()
    expect(keyOf('E:/', 'a.jpg')).toBe('E:/a.jpg')
    expect(keyOf('/photos/photo', 'a.jpg')).toBe('/photos/photo/a.jpg')

    const { key, sourceId } = await pair()
    await agentFetch(key, '/api/agent/folders', json({ folders: ['E:/', 'E:/Archive'], volumes: [{ id: 'volume:X', label: 'Archive 2014-B', path: 'E:/', removable: true }] }))
    const res = await h.fetch(`/api/sources/${sourceId}/roots`, { ...json({ path: 'E:/' }), cookie: admin })
    const { root } = (await res.json()) as { root: { id: string; label: string; volume: { id: string; path: string } } }
    expect(root).toMatchObject({ label: 'Archive 2014-B', volume: { id: 'volume:X', path: 'E:/' } })
    const sent = await send(key, [{ root: root.id, path: '2014/a.jpg', size: 1, quickHash: hex('w') }])
    expect(sent.body.results[0]!.result).toBe('created')
    const id = sent.body.results[0]!.assetId
    const where = (await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as { locations: { state: string }[] }
    expect(where.locations[0]!.state).toBe('present')

    expect(await (await agentFetch(key, `/api/agent/roots/${root.id}/status`, json({ online: false }))).json()).toMatchObject({ offlineSince: expect.any(String) })
    const list = (await (await h.fetch('/api/sources', { cookie: admin })).json()) as { sources: { roots: { offlineSince: string | null }[]; volumes: unknown[] }[] }
    expect(list.sources[0]!.roots[0]!.offlineSince).not.toBeNull()
    expect(list.sources[0]!.volumes).toHaveLength(1)
    await agentFetch(key, `/api/agent/roots/${root.id}/status`, json({ online: true }))
    expect(((await (await h.fetch('/api/sources', { cookie: admin })).json()) as typeof list).sources[0]!.roots[0]!.offlineSince).toBeNull()
  })
})
