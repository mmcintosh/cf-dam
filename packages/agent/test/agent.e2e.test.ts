/**
 * The real agent against the real API (in-process, as the API's own tests run it): pair, index a
 * folder, stop halfway and resume without duplicates, recognise a rename, report a deletion.
 */
import { randomBytes } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, json, setUpAdmin, type Harness } from '../../api/test/harness.ts'
import { Api, ApiError, LinkError, Unpaired } from '../src/api.ts'
import { Agent } from '../src/main.ts'
import type { Volume } from '../src/volumes.ts'

const placesGz = readFileSync(new URL('../../../public/places/cities1000.tsv.gz', import.meta.url))
const ASSETS = { fetch: async () => new Response(placesGz) } as unknown as Fetcher
const BASE = 'http://localhost'

let h: Harness
let admin: string
let photos: string
let data: string
const calls: string[] = []

beforeEach(async () => {
  h = await createHarness({ ASSETS })
  admin = await setUpAdmin(h)
  photos = mkdtempSync(join(tmpdir(), 'nas-photos-'))
  data = mkdtempSync(join(tmpdir(), 'nas-data-'))
  calls.length = 0
  volumes = []
  fault = null
})
afterEach(async () => {
  await h.dispose()
  rmSync(photos, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

let volumes: Volume[] = []

/** Trouble on the line: return a response (or throw) instead of reaching cf-dam. */
let fault: ((path: string) => Response | null) | null = null

function newAgent(): Agent {
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const path = url.slice(BASE.length)
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    const injected = fault?.(path)
    if (injected) return injected
    return h.fetch(path, init as RequestInit & { cookie?: string })
  }
  return new Agent({ url: BASE, dataDir: data, photosDir: photos, port: 0, host: '127.0.0.1', workers: 2, name: 'Test NAS' }, new Api(BASE, null, fetchImpl, 1), async () => volumes)
}

async function photo(rel: string, seed: number) {
  const path = join(photos, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  await sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: (seed * 53) % 256, g: (seed * 97) % 256, b: (seed * 31) % 256 } } })
    .composite([{ input: Buffer.from(`<svg width="1600" height="1000"><circle cx="${200 + ((seed * 137) % 1200)}" cy="500" r="${100 + (seed % 7) * 40}" fill="#fff"/></svg>`) }])
    .jpeg({ quality: 80 })
    .withExif({ IFD0: { Make: 'Nikon', Model: 'Z 8' }, IFD2: { DateTimeOriginal: `2023:05:${String(1 + (seed % 28)).padStart(2, '0')} 12:00:00` } })
    .toFile(path)
}

const list = async (query = '') =>
  (await (await h.fetch(`/api/assets?limit=200${query}`, { cookie: admin })).json()) as { total: number; assets: { id: string; filename: string; status: string; renditions: string[]; storage: { storageClass: string } | null }[] }

async function pairAndAddRoot(agent: Agent): Promise<void> {
  const pairing = agent.pair()
  while (!agent.status().pairingCode) await new Promise((r) => setTimeout(r, 20))
  const res = await h.fetch('/api/sources/pair', { ...json({ code: agent.status().pairingCode }), cookie: admin })
  expect(res.status).toBe(201)
  const { source } = (await res.json()) as { source: { id: string } }
  await pairing
  await agent.reportFolders()
  const sources = (await (await h.fetch('/api/sources', { cookie: admin })).json()) as { sources: { folders: string[] }[] }
  expect(sources.sources[0]!.folders).toContain(join(photos, '2023'))
  expect((await h.fetch(`/api/sources/${source.id}/roots`, { ...json({ path: photos }), cookie: admin })).status).toBe(201)
}

describe('the agent, end to end', () => {
  it('indexes a folder in place, resumes after being stopped, and recognises renames and deletions', async () => {
    for (let i = 0; i < 4; i++) await photo(`2023/IMG_${1000 + i}.jpg`, i)
    copyFileSync(new URL('../../api/test/fixtures/iptc.jpg', import.meta.url).pathname, join(photos, '2023', 'bergen.jpg'))
    mkdirSync(join(photos, '2023', '@eaDir'))
    await photo('2023/@eaDir/SYNOPHOTO_THUMB_XL.jpg', 99)

    const agent = newAgent()
    await pairAndAddRoot(agent)
    await agent.scanAll()

    let all = await list()
    expect(all.total).toBe(5)
    expect(all.assets.every((a) => a.renditions.includes('thumb') && a.renditions.includes('preview') && a.storage?.storageClass === 'NAS')).toBe(true)
    const bergen = all.assets.find((a) => a.filename === 'bergen.jpg')!
    const detail = (await (await h.fetch(`/api/assets/${bergen.id}`, { cookie: admin })).json()) as { iptc: Record<string, string>; tags: { path: string }[]; label: string }
    expect(detail.iptc).toMatchObject({ creator: 'Mark Photographer', city: 'Bergen' })
    expect(detail.tags.map((t) => t.path)).toEqual(['Places › Norway › Bergen'])
    expect(detail.label).toBe('red')

    // Nothing changed: a rescan sends nothing.
    calls.length = 0
    await agent.scanAll()
    expect(calls.filter((c) => c.includes('/assets/'))).toEqual([])

    // Thirty more, and the agent is stopped after its first batch of twenty…
    for (let i = 10; i < 40; i++) await photo(`2024/IMG_${2000 + i}.jpg`, i)
    const interrupted = newAgent()
    await interrupted.pair()
    const stopper = setInterval(() => calls.some((c) => c.endsWith('/assets/complete')) && interrupted.stop(), 5)
    await interrupted.scanAll()
    clearInterval(stopper)
    const partial = (await list()).total
    expect(partial).toBeGreaterThan(5)
    expect(partial).toBeLessThan(35)
    // …and a fresh start finishes the job without duplicating anything.
    const resumed = newAgent()
    await resumed.pair()
    await resumed.scanAll()
    all = await list()
    expect(all.total).toBe(35)
    expect(new Set(all.assets.map((a) => a.filename)).size).toBe(35)

    // Renamed on the NAS: same photo, new name. Deleted: marked missing, still in the catalogue.
    const before = all.assets.find((a) => a.filename === 'IMG_1001.jpg')!
    renameSync(join(photos, '2023', 'IMG_1001.jpg'), join(photos, '2023', 'Wedding-0001.jpg'))
    rmSync(join(photos, '2023', 'IMG_1002.jpg'))
    await resumed.scanAll()
    all = await list()
    expect(all.total).toBe(35)
    expect(all.assets.find((a) => a.id === before.id)?.filename).toBe('Wedding-0001.jpg')
    const deleted = all.assets.find((a) => a.filename === 'IMG_1002.jpg')!
    const gone = (await (await h.fetch(`/api/assets/${deleted.id}`, { cookie: admin })).json()) as { locations: { state: string }[] }
    expect(gone.locations[0]!.state).toBe('missing')
  }, 180_000) // 35 photos through the local D1, at ~25 ms a query

  it('treats an unplugged drive as offline, and finds it again at a new mount point', async () => {
    // A USB drive, seen by the agent as a volume mounted at <photos>/Drive.
    const mount = join(photos, 'Drive')
    for (let i = 0; i < 3; i++) await photo(`Drive/2014/IMG_${3000 + i}.jpg`, i + 50)
    volumes = [{ id: 'uuid:ARCHIVE-2014-B', label: 'Archive 2014-B', path: mount, removable: true }]
    const agent = newAgent()
    const pairing = agent.pair()
    while (!agent.status().pairingCode) await new Promise((r) => setTimeout(r, 20))
    const { source } = (await (await h.fetch('/api/sources/pair', { ...json({ code: agent.status().pairingCode }), cookie: admin })).json()) as { source: { id: string } }
    await pairing
    await agent.reportFolders()
    const added = (await (await h.fetch(`/api/sources/${source.id}/roots`, { ...json({ path: mount }), cookie: admin })).json()) as { root: { id: string; volume: { label: string } | null; label: string } }
    expect(added.root).toMatchObject({ label: 'Archive 2014-B', volume: { label: 'Archive 2014-B' } })
    await agent.scanAll()
    expect((await list()).total).toBe(3)

    // Unplugged: the folder is unreachable. Offline, and nothing goes missing. Another card that
    // mounts where it used to be, with the same name, is not it: nothing is imported from it.
    const elsewhere = join(photos, 'Drive 1')
    renameSync(mount, elsewhere)
    volumes = []
    await photo('Drive/DCIM/IMG_9000.jpg', 77)
    await agent.scanAll()
    expect((await list()).total).toBe(3)
    const sources = (await (await h.fetch('/api/sources', { cookie: admin })).json()) as { sources: { roots: { offlineSince: string | null }[]; photos: { missing: number } }[] }
    expect(sources.sources[0]!.roots[0]!.offlineSince).not.toBeNull()
    expect(sources.sources[0]!.photos.missing).toBe(0)
    const one = (await list()).assets[0]!
    const page = (await (await h.fetch(`/api/assets/${one.id}`, { cookie: admin })).json()) as { locations: { state: string }[] }
    expect(page.locations[0]!.state).toBe('present')

    // Plugged back in, mounted as "Drive 1" this time, with a photo added meanwhile: found by its id,
    // only the new photo sent (read from where the drive is now), online again.
    volumes = [{ id: 'uuid:ARCHIVE-2014-B', label: 'Archive 2014-B', path: elsewhere, removable: true }]
    await photo('Drive 1/2014/IMG_3003.jpg', 60)
    calls.length = 0
    await agent.scanAll()
    expect(calls.filter((c) => c.includes('/assets/batch'))).toHaveLength(1)
    const after = (await (await h.fetch('/api/sources', { cookie: admin })).json()) as { sources: { roots: { offlineSince: string | null }[]; photos: { total: number; missing: number } }[] }
    expect(after.sources[0]!.roots[0]!.offlineSince).toBeNull()
    expect(after.sources[0]!.photos).toMatchObject({ total: 4, missing: 0 })
    const newcomer = (await list()).assets.find((a) => a.filename === 'IMG_3003.jpg')
    expect(newcomer?.renditions).toContain('thumb')
  })

  it('finishes photos a broken scan left half-sent, and keeps one bad file from stopping the rest', async () => {
    for (let i = 0; i < 3; i++) await photo(`2023/IMG_${4000 + i}.jpg`, i + 20)
    writeFileSync(join(photos, '2023', 'broken.jpg'), randomBytes(5000))
    const agent = newAgent()
    await pairAndAddRoot(agent)
    // The link drops just as the batch is to be finished: the scan stops, nothing is recorded…
    fault = (path) => (path === '/api/agent/assets/complete' ? Response.json({ error: 'internal' }, { status: 503 }) : null)
    await expect(agent.scanAll()).rejects.toBeInstanceOf(ApiError)
    expect((await list()).assets.filter((a) => a.status === 'processing')).toHaveLength(3)
    // …so the next scan sends those photos again, and cf-dam finishes them: no duplicates.
    fault = null
    await agent.scanAll()
    const all = await list()
    expect(all.total).toBe(3)
    expect(all.assets.every((a) => a.status === 'ready')).toBe(true)
    // The broken file is recorded against itself, and left alone after three tries.
    expect(agent.status().failed).toBe(1)
    calls.length = 0
    await agent.scanAll()
    await agent.scanAll()
    await agent.scanAll()
    expect(calls.filter((c) => c.includes('/assets/'))).toEqual([])
  })

  it('after dying mid-read, blames that file once, reads it on its own, and finishes it', async () => {
    for (let i = 0; i < 3; i++) await photo(`2023/IMG_${5000 + i}.jpg`, i + 40)
    const agent = newAgent()
    await pairAndAddRoot(agent)
    await agent.scanAll()
    expect((await list()).total).toBe(3)
    // The photo is edited, and the agent is killed (out of memory, say) while reading it.
    await photo('2023/IMG_5001.jpg', 99)
    const { root_id: rootId } = agent.state.db.prepare('SELECT root_id FROM files LIMIT 1').get() as { root_id: string }
    agent.state.reading(rootId, '2023/IMG_5001.jpg', { size: 1, mtimeMs: 1, quickHash: 'x' })
    agent.state.db.close()
    // Started again: it shows as failed, is tried again, and this time goes through.
    const again = newAgent()
    expect(again.status().failed).toBe(1)
    await again.pair() // the saved key
    calls.length = 0
    await again.scanAll()
    expect(again.status()).toMatchObject({ failed: 0, done: 3 })
    expect(calls.filter((c) => c.startsWith('POST /api/agent/assets/batch'))).toHaveLength(1)
    expect((await list()).total).toBe(3)
  })

  it('recognises a photo moved between two indexed folders, whichever is scanned first', async () => {
    await photo('B/2019/IMG_5000.jpg', 31)
    await photo('B/2019/IMG_5001.jpg', 32)
    const agent = newAgent()
    const pairing = agent.pair()
    while (!agent.status().pairingCode) await new Promise((r) => setTimeout(r, 20))
    const { source } = (await (await h.fetch('/api/sources/pair', { ...json({ code: agent.status().pairingCode }), cookie: admin })).json()) as { source: { id: string } }
    await pairing
    for (const dir of ['A', 'B']) {
      mkdirSync(join(photos, dir), { recursive: true })
      expect((await h.fetch(`/api/sources/${source.id}/roots`, { ...json({ path: join(photos, dir) }), cookie: admin })).status).toBe(201)
    }
    await agent.scanAll()
    const before = (await list()).assets.find((a) => a.filename === 'IMG_5000.jpg')!
    // Moved from B to A; A comes first in the scan.
    mkdirSync(join(photos, 'A', 'sorted'))
    renameSync(join(photos, 'B', '2019', 'IMG_5000.jpg'), join(photos, 'A', 'sorted', 'IMG_5000.jpg'))
    await agent.scanAll()
    const all = await list()
    expect(all.total).toBe(2)
    const after = (await (await h.fetch(`/api/assets/${before.id}`, { cookie: admin })).json()) as { locations: { state: string }[] }
    expect(after.locations).toEqual([expect.objectContaining({ state: 'present' })])
    expect((await list('&missing=1')).total).toBe(0)

    // A folder switched off and on again isn't re-read from scratch.
    const sources = (await (await h.fetch('/api/sources', { cookie: admin })).json()) as { sources: { roots: { id: string }[] }[] }
    const rootB = sources.sources[0]!.roots[1]!.id
    await h.fetch(`/api/sources/${source.id}/roots/${rootB}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }), cookie: admin })
    await agent.scanAll()
    await h.fetch(`/api/sources/${source.id}/roots/${rootB}`, { method: 'PATCH', body: JSON.stringify({ enabled: true }), cookie: admin })
    calls.length = 0
    await agent.scanAll()
    expect(calls.filter((c) => c.includes('/assets/'))).toEqual([])
  })

  it('keeps its key and its file list when a firewall, not cf-dam, says 403', async () => {
    await photo('2023/IMG_6000.jpg', 40)
    const agent = newAgent()
    await pairAndAddRoot(agent)
    await agent.scanAll()
    const blocked = () => new Response('<html><body>Sorry, you have been blocked</body></html>', { status: 403, headers: { 'Content-Type': 'text/html' } })
    fault = blocked
    await expect(agent.scanAll()).rejects.toBeInstanceOf(ApiError)
    expect(agent.state.credentials(BASE)).not.toBeNull()
    // cf-dam's own refusal is the key gone.
    fault = () => Response.json({ error: 'unauthenticated' }, { status: 401 })
    await expect(agent.scanAll()).rejects.toBeInstanceOf(Unpaired)
    // No network at all is the link.
    fault = () => {
      throw new TypeError('fetch failed')
    }
    await expect(agent.scanAll()).rejects.toBeInstanceOf(LinkError)
    fault = null

    // Losing the key keeps the file list; pairing again as the same source keeps it, as a new one clears it.
    const saved = agent.state.credentials(BASE)!
    agent.state.clearCredentials()
    expect(agent.state.counts().done).toBe(1)
    agent.state.saveCredentials(saved)
    expect(agent.state.counts().done).toBe(1)
    agent.state.saveCredentials({ ...saved, sourceId: 'another' })
    expect(agent.state.counts().done).toBe(0)
  })
})
