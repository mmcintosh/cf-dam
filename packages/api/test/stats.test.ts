import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addTags } from '../src/catalog/assets'
import { duplicateCounts } from '../src/catalog/duplicates'
import { keywordTree } from '../src/catalog/keywords'
import { FACET_LIVE_MAX, facets, timeline } from '../src/catalog/library'
import { getStats, statsStep } from '../src/catalog/stats'
import { createHarness, setUpAdmin, type Harness } from './harness'

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

const CAMERAS = ['NIKON Z 9', 'NIKON D500', 'Canon EOS R5']
const COUNTRIES = ['Norway', 'Kenya', null]

/** A small catalog with something in every facet, duplicates, keywords, and checked locations. */
async function fill(): Promise<string[]> {
  const ids = Array.from({ length: 40 }, (_, i) => `p${String(i).padStart(2, '0')}`)
  await h.env.DB.batch(
    ids.map((id, i) =>
      h.env.DB.prepare(
        `INSERT INTO assets (id, filename, mime_type, status, created_at, updated_at, captured_at, camera_model, lens, rating, flag, label, country, city, width, height, sha256)
         VALUES (?, ?, ?, 'ready', '2026-01-01', '2026-01-01', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, `IMG_${i}.jpg`, i % 7 === 0 ? 'image/x-nikon-nef' : 'image/jpeg', i % 9 === 0 ? null : `${2010 + (i % 5)}-0${1 + (i % 9)}-15T10:00:00Z`,
        CAMERAS[i % 3], i % 2 ? 'NIKKOR Z 800mm' : null, i % 4 ? i % 6 : null, i % 10 === 0 ? 'pick' : null, i % 8 === 0 ? 'red' : null,
        COUNTRIES[i % 3], i % 3 === 0 ? 'Bergen' : null, 6000, i % 5 ? 4000 : 8000, i < 6 ? `dup${i % 2}` : `sha${i}`,
      ),
    ),
  )
  await addTags(h.env.DB, ids.slice(0, 20), ['Places|Norway|Bergen'], 'user')
  await addTags(h.env.DB, ids.slice(10, 30), ['Places|Kenya', 'Birds|Herons|Grey heron'], 'user')
  await addTags(h.env.DB, ids.slice(25), ['Birds|Owls'], 'user')
  await h.env.DB.batch(
    ids.map((id, i) =>
      h.env.DB.prepare(
        "INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, updated_at, check_result, checked_at) VALUES (?, 'r2', ?, ?, 'present', '2026-01-01', ?, ?)",
      ).bind(id, `o/${id}`, i % 4 === 0 ? 'STANDARD_IA' : 'STANDARD', [null, 'ok', 'ok', 'missing'][i % 4], i % 4 ? `2026-02-0${1 + (i % 8)}T00:00:00Z` : null),
    ),
  )
  // One soft-deleted photo, which nothing counts.
  await h.env.DB.prepare("UPDATE assets SET deleted_at = '2026-03-01' WHERE id = 'p39'").run()
  return ids
}

/** Build a snapshot in slices of `rows`, one slice a run. Returns how many runs it took. */
async function build(rows: number): Promise<number> {
  for (let run = 1; run < 200; run++) {
    let n = 0
    if (await statsStep(h.env, () => n++ < 1, rows)) return run
  }
  throw new Error('the snapshot never finished')
}

const checksPage = async () => (await (await h.fetch('/api/storage-checks', { cookie: admin })).json()) as { totals: Record<string, number>; lastCheckedAt: string }

describe('the whole-archive snapshot', () => {
  it('gives exactly what counting live gives, built in small slices', async () => {
    await fill()
    const live = { facets: await facets(h.env.DB, {}), timeline: await timeline(h.env.DB, {}), keywords: await keywordTree(h.env.DB), duplicates: await duplicateCounts(h.env.DB), checks: await checksPage() }
    expect(live.duplicates.exact).toBe(2)

    expect(await build(7)).toBeGreaterThan(10)
    const stats = (await getStats(h.env.DB))!
    expect(stats.photos).toBe(39)
    expect(await facets(h.env.DB, {})).toEqual(live.facets)
    expect(await timeline(h.env.DB, {})).toEqual(live.timeline)
    expect(await keywordTree(h.env.DB)).toEqual(live.keywords)
    expect(await duplicateCounts(h.env.DB)).toEqual(live.duplicates)
    expect(await checksPage()).toEqual(live.checks)
  })

  it('is rebuilt only once it is ten minutes old', async () => {
    await fill()
    await build(1000)
    expect(await statsStep(h.env, () => true)).toBe(false)
    await h.env.DB.prepare("UPDATE settings SET updated_at = '2020-01-01' WHERE key = 'stats'").run()
    expect(await statsStep(h.env, () => true)).toBe(true)
  })

  it("answers a facet whose own choice is the only filter from the snapshot, others live", async () => {
    await fill()
    const wholeYears = (await facets(h.env.DB, {})).year
    await build(1000)
    // Choosing a year: the year facet still lists every year with its whole-archive count.
    const chosen = await facets(h.env.DB, { year: '2011' })
    expect(chosen.year).toEqual(wholeYears)
    // The others count within 2011, live.
    const in2011 = (await h.env.DB.prepare("SELECT camera_model AS value, COUNT(*) AS count FROM assets WHERE deleted_at IS NULL AND captured_at >= '2011' AND captured_at < '2012' GROUP BY camera_model ORDER BY count DESC, value").all()).results
    expect(chosen.camera).toEqual(in2011)
  })

  it('shows values without counts when too many photos match to count', async () => {
    await fill()
    await h.env.DB.prepare(
      `INSERT INTO assets (id, filename, mime_type, status, created_at, updated_at, camera_model, country)
       SELECT 'big' || value, 'b' || value || '.jpg', 'image/jpeg', 'ready', '2026-01-01', '2026-01-01', 'Big Camera', 'Iceland' FROM json_each(?)`,
    )
      .bind(JSON.stringify(Array.from({ length: FACET_LIVE_MAX + 1 }, (_, i) => i)))
      .run()
    await build(100_000)
    const big = await facets(h.env.DB, { country: 'Iceland' })
    // The country facet is only filtered by itself: counted, from the snapshot.
    expect(big.country.find((v) => v.value === 'Iceland')?.count).toBe(FACET_LIVE_MAX + 1)
    // Within Iceland, too many to count: values, no counts.
    expect(big.camera.length).toBeGreaterThan(0)
    expect(big.camera.every((v) => v.count === null)).toBe(true)
    expect(big.tag.every((k) => k.count === null)).toBe(true)
    expect(await timeline(h.env.DB, { country: 'Iceland' })).toEqual([])
  })
})
