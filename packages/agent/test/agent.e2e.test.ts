/**
 * The real agent against the real API (in-process, as the API's own tests run it): pair, index a
 * folder, stop halfway and resume without duplicates, recognise a rename, report a deletion.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, json, setUpAdmin, type Harness } from '../../api/test/harness.ts'
import { Api } from '../src/api.ts'
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
})
afterEach(async () => {
  await h.dispose()
  rmSync(photos, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

let volumes: Volume[] = []

function newAgent(): Agent {
  const fetchImpl = (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url.slice(BASE.length)}`)
    return h.fetch(url.slice(BASE.length), init as RequestInit & { cookie?: string })
  }
  return new Agent({ url: BASE, dataDir: data, photosDir: photos, port: 0, workers: 2, name: 'Test NAS' }, new Api(BASE, null, fetchImpl, 1), async () => volumes)
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
  (await (await h.fetch(`/api/assets?limit=200${query}`, { cookie: admin })).json()) as { total: number; assets: { id: string; filename: string; renditions: string[]; storage: { storageClass: string } | null }[] }

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
    const stopper = setInterval(() => interrupted.status().progress.sent >= 1 && interrupted.stop(), 5)
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
  })

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

    // Unplugged: the folder is unreachable. Offline, and nothing goes missing.
    const elsewhere = join(photos, 'Drive 1')
    renameSync(mount, elsewhere)
    volumes = []
    await agent.scanAll()
    const sources = (await (await h.fetch('/api/sources', { cookie: admin })).json()) as { sources: { roots: { offlineSince: string | null }[]; photos: { missing: number } }[] }
    expect(sources.sources[0]!.roots[0]!.offlineSince).not.toBeNull()
    expect(sources.sources[0]!.photos.missing).toBe(0)
    const one = (await list()).assets[0]!
    const page = (await (await h.fetch(`/api/assets/${one.id}`, { cookie: admin })).json()) as { locations: { state: string }[] }
    expect(page.locations[0]!.state).toBe('present')

    // Plugged back in, mounted as "Drive 1" this time: found by its id, nothing re-sent, online again.
    volumes = [{ id: 'uuid:ARCHIVE-2014-B', label: 'Archive 2014-B', path: elsewhere, removable: true }]
    calls.length = 0
    await agent.scanAll()
    expect(calls.filter((c) => c.includes('/assets/'))).toEqual([])
    const after = (await (await h.fetch('/api/sources', { cookie: admin })).json()) as { sources: { roots: { offlineSince: string | null }[]; photos: { total: number; missing: number } }[] }
    expect(after.sources[0]!.roots[0]!.offlineSince).toBeNull()
    expect(after.sources[0]!.photos).toMatchObject({ total: 3, missing: 0 })
  })
})
