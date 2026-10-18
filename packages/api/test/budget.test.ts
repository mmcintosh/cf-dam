/**
 * D1 allows 1,000 queries per Worker invocation on Workers Paid (50 on Free). These tests count the
 * round trips the heaviest requests make at their largest, so a change that adds a query per item
 * shows up here rather than as a failing request on a real archive.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSweep, SLICES } from '../src/catalog/sweeper'
import { createHarness, json, setUpAdmin, type Harness, type QueryCount } from './harness'

const placesGz = readFileSync(new URL('../../../public/places/cities1000.tsv.gz', import.meta.url))
const ASSETS = { fetch: async () => new Response(placesGz) } as unknown as Fetcher
const AI = { run: async () => ({ response: '{}' }) } as unknown as Ai

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness({ ASSETS, AI })
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

/**
 * A request's share: within the Free plan's 50 round trips (signing in included), and within the
 * Paid plan's 1,000 even if every statement in a batch counted on its own.
 */
function withinBudget(what: string, n: QueryCount, roundTrips = 50) {
  if (process.env.BUDGET_REPORT) process.stderr.write(`[budget] ${what}: ${n.roundTrips} round trips, ${n.statements} statements\n`)
  expect(n.roundTrips, what).toBeLessThanOrEqual(roundTrips)
  expect(n.statements, what).toBeLessThanOrEqual(1000)
}

async function agent(): Promise<{ key: string; root: string }> {
  const start = (await (await h.fetch('/api/agent/pair/start', json({ name: 'NAS' }))).json()) as { deviceCode: string; userCode: string }
  await h.fetch('/api/sources/pair', { ...json({ code: start.userCode }), cookie: admin })
  const { apiKey: key, sourceId } = (await (await h.fetch('/api/agent/pair/poll', json({ deviceCode: start.deviceCode }))).json()) as { apiKey: string; sourceId: string }
  await h.fetch('/api/agent/folders', { ...json({ folders: ['/photos'] }), headers: { Authorization: `Bearer ${key}` } })
  const res = await h.fetch(`/api/sources/${sourceId}/roots`, { ...json({ path: '/photos', label: 'Photos' }), cookie: admin })
  return { key, root: ((await res.json()) as { root: { id: string } }).root.id }
}

const hex = (n: number) => n.toString(16).padStart(64, '0')

/** A photo as a Lightroom-keyworded archive sends it: ten keywords, most shared, a few its own. */
const item = (root: string, n: number, batch = 0) => ({
  root,
  path: `${2010 + batch}/${String(n).padStart(4, '0')}.CR3`,
  size: 1_000_000 + n,
  mtime: '2019-06-01T10:00:00Z',
  quickHash: hex(batch * 1000 + n + 1),
  metadata: {
    width: 6000, height: 4000, capturedAt: '2019-06-01T09:58:12', cameraMake: 'Canon', cameraModel: 'Canon EOS R5',
    gpsLat: 60.39 + n / 1000, gpsLng: 5.32, rating: 3, label: 'Blue',
    iptc: { creator: 'Mark', credit: 'Studio' },
    keywords: [
      'Places|Europe|Norway|Bergen', 'Places|Europe|Norway', 'People|Clients|Acme', 'Subjects|Harbour', 'Subjects|Boats',
      'Light|Golden hour', `Jobs|${2010 + batch}|Job ${Math.floor(n / 10)}`, `Frames|F${n}`, 'Bergen', 'Fjord',
    ],
  },
})

async function send(key: string, items: unknown[]) {
  const res = await h.fetch('/api/agent/assets/batch', { ...json({ items }), headers: { Authorization: `Bearer ${key}` } })
  expect(res.status).toBe(200)
  return ((await res.json()) as { results: { assetId: string; result: string }[] }).results
}

async function complete(key: string, ids: string[]) {
  const res = await h.fetch('/api/agent/assets/complete', { ...json({ items: ids.map((id, i) => ({ id, phash: (i * 7919).toString(16).padStart(16, 'a') })) }), headers: { Authorization: `Bearer ${key}` } })
  expect(res.status).toBe(200)
  return ((await res.json()) as { results: { status: string }[] }).results
}

describe('queries per request', () => {
  it('an agent batch of 100 new photos, finishing them, and sending them again', async () => {
    const { key, root } = await agent()
    const items = Array.from({ length: 100 }, (_, n) => item(root, n))
    let results: { assetId: string; result: string }[] = []
    const ingest = await h.count(async () => (results = await send(key, items)))
    withinBudget('ingest 100 new', ingest)
    expect(results.every((r) => r.result === 'created')).toBe(true)

    let done: { status: string }[] = []
    const finish = await h.count(async () => (done = await complete(key, results.map((r) => r.assetId))))
    withinBudget('complete 100', finish)
    expect(done.every((r) => r.status === 'ready')).toBe(true)

    const again = await h.count(async () => (results = await send(key, items)))
    withinBudget('ingest 100 unchanged', again)
    expect(results.every((r) => r.result === 'unchanged')).toBe(true)

    const missing = await h.count(() =>
      h.fetch('/api/agent/scans/complete', { ...json({ root, missing: Array.from({ length: 5000 }, (_, n) => `gone/${n}.jpg`) }), headers: { Authorization: `Bearer ${key}` } }),
    )
    withinBudget('scan complete, 5,000 missing', missing)
  })

  it('bulk edits of 500 photos, the library and duplicates pages, and the sweep with every queue full', async () => {
    const { key, root } = await agent()
    const ids: string[] = []
    for (let b = 0; b < 5; b++) ids.push(...(await send(key, Array.from({ length: 100 }, (_, n) => item(root, n, b)))).map((r) => r.assetId))
    for (let b = 0; b < 5; b++) await complete(key, ids.slice(b * 100, (b + 1) * 100))

    for (const [action, extra] of [
      ['tag-add', { tags: ['Archive|Scanned', 'Archive|2024', 'Review', 'Clients > Acme > Spring', 'Portfolio'] }],
      ['tag-remove', { tags: ['Review', 'Fjord'] }],
      ['title', { title: 'Harbour at dusk' }],
      ['gps', { lat: 59.91, lng: 10.75 }],
      ['rating', { rating: 4 }],
      ['ai-accept', { fields: ['caption', 'tags'] }],
    ] as const) {
      const n = await h.count(async () => {
        const res = await h.fetch('/api/assets/bulk', { ...json({ ids, action, ...extra }), cookie: admin })
        expect(res.status).toBe(200)
      })
      withinBudget(`bulk ${action} 500`, n)
    }
    expect(((await (await h.fetch('/api/assets?q=harbour&limit=1', { cookie: admin })).json()) as { total: number }).total).toBe(500)

    for (const path of ['/api/assets?limit=200', '/api/assets/facets', '/api/tags', '/api/duplicates/similar', '/api/duplicates/exact']) {
      const n = await h.count(async () => expect((await h.fetch(path, { cookie: admin })).status).toBe(200))
      withinBudget(`GET ${path}`, n)
    }

    // Every queue the sweep works on, full: the index rebuilt, places and hashes never done, uploads
    // waiting, photos abandoned in 'processing'.
    await h.env.DB.batch([
      h.env.DB.prepare('DELETE FROM search_index'),
      h.env.DB.prepare('UPDATE assets SET indexed_at = NULL, place_checked_at = NULL, phash = NULL'),
      h.env.DB.prepare(
        `UPDATE assets SET status = CASE WHEN rowid % 5 = 0 THEN 'queued' WHEN rowid % 5 = 1 THEN 'processing' ELSE status END, updated_at = '2020-01-01T00:00:00Z'`,
      ),
    ])
    let swept: Awaited<ReturnType<typeof runSweep>> | undefined
    const sweep = await h.count(async () => (swept = await runSweep(h.env)))
    withinBudget('sweep', sweep, 900)
    // Each stage got its turn (how far each gets depends on the clock: local D1 is slow).
    for (const stage of ['processed', 'recovered', 'indexed', 'placed'] as const) expect(swept![stage], stage).toBeGreaterThan(0)

    const deleting = await h.count(async () => expect((await h.fetch('/api/assets/bulk', { ...json({ ids, action: 'delete' }), cookie: admin })).status).toBe(200))
    withinBudget('bulk delete 500', deleting)
  }, 180_000)
})

describe('the sweep', () => {
  it('gives every stage its turn, however much one of them has waiting', async () => {
    const { key, root } = await agent()
    const ids = (await send(key, Array.from({ length: 60 }, (_, n) => item(root, n)))).map((r) => r.assetId)
    await complete(key, ids)
    // A backlog of processing far beyond one run, and an index and places to catch up on.
    await h.env.DB.prepare("UPDATE assets SET status = 'queued', indexed_at = NULL, place_checked_at = NULL").run()
    const swept = await runSweep(h.env, { ...SLICES, process: { ms: 300, queries: 350 } })
    expect(swept.processed).toBeLessThan(60)
    expect(swept.indexed).toBeGreaterThan(0)
    expect(swept.placed).toBeGreaterThan(0)
    // The same with the queries the processing stage may make, rather than its time.
    await h.env.DB.prepare("UPDATE assets SET status = 'queued', indexed_at = NULL, place_checked_at = NULL").run()
    const counted = await runSweep(h.env, { ...SLICES, process: { ms: 60_000, queries: 20 } })
    expect(counted.processed).toBeLessThan(5)
    expect(counted.indexed).toBeGreaterThan(0)
  })
})
