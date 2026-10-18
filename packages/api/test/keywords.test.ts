import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSweep } from '../src/catalog/sweeper'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

let h: Harness
let admin: string
let ids: string[]

async function upload(filename: string): Promise<string> {
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength, allowDuplicate: true }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

const patch = (id: string, body: unknown) => h.fetch(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body), cookie: admin })
const total = async (query: string) => ((await (await h.fetch(`/api/assets?${query}`, { cookie: admin })).json()) as { total: number }).total
const tree = async () =>
  ((await (await h.fetch('/api/tags', { cookie: admin })).json()) as { keywords: { id: string; name: string; path: string; parentId: string | null; count: number; total: number; synonyms: string[] }[] }).keywords
const byPath = async (path: string) => (await tree()).find((k) => k.path === path)!
const tagsOf = async (id: string) =>
  ((await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as { tags: { name: string; path: string; source: string }[] }).tags
const xmp = async (id: string) => (await h.fetch(`/api/assets/${id}/xmp`, { cookie: admin })).text()

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  ids = [await upload('bergen.jpg'), await upload('oslo.jpg'), await upload('smith.jpg')]
})
afterEach(async () => h.dispose())

describe('the keyword tree', () => {
  it('creates paths as typed and finds photos by any level above their keyword', async () => {
    await patch(ids[0]!, { tags: ['Places > Europe > Norway > Bergen'] })
    await patch(ids[1]!, { tags: ['Places | Europe | Norway | Oslo', 'harbour'] })
    expect((await tagsOf(ids[0]!)).map((t) => t.path)).toEqual(['Places › Europe › Norway › Bergen'])

    const norway = await byPath('Places › Europe › Norway')
    expect(norway).toMatchObject({ name: 'Norway', count: 0, total: 2 })
    expect((await byPath('Places › Europe › Norway › Bergen')).parentId).toBe(norway.id)

    // Filter by an ancestor, by a path, by a leaf name; search reaches ancestors.
    expect(await total('tag=Norway')).toBe(2)
    expect(await total(`tag=${encodeURIComponent('Places > Europe > Norway > Oslo')}`)).toBe(1)
    expect(await total('tag=Bergen')).toBe(1)
    expect(await total('q=europe')).toBe(2)

    // Facet counts roll up.
    const facets = (await (await h.fetch('/api/assets/facets', { cookie: admin })).json()) as { tag: { name: string; count: number; parentId: string | null }[] }
    expect(facets.tag.find((t) => t.name === 'Places')).toMatchObject({ count: 2, parentId: null })
    expect(facets.tag.find((t) => t.name === 'Oslo')?.count).toBe(1)
  })

  it('keeps same-named keywords apart and resolves plain names sensibly', async () => {
    await patch(ids[0]!, { tags: ['People > Smith'] })
    await patch(ids[1]!, { tags: ['Places > Streets > Smith'] })
    expect((await tree()).filter((k) => k.name === 'Smith')).toHaveLength(2)
    expect(await total('tag=Smith')).toBe(2)
    expect(await total(`tag=${encodeURIComponent('People > Smith')}`)).toBe(1)
    // A plain name reuses an existing keyword rather than making a third Smith.
    await patch(ids[2]!, { tags: ['Smith'] })
    expect((await tree()).filter((k) => k.name === 'Smith')).toHaveLength(2)
    // Autocomplete shows the paths.
    const found = (await (await h.fetch('/api/tags?q=smi', { cookie: admin })).json()) as { keywords: { path: string }[] }
    expect(found.keywords.map((k) => k.path).sort()).toEqual(['People › Smith', 'Places › Streets › Smith'])
  })

  it('renames and moves branches, keeping search in step', async () => {
    await patch(ids[0]!, { tags: ['Trips > Norway 2024 > Bergen'] })
    const trip = await byPath('Trips › Norway 2024')
    const { id: placesId } = ((await (await h.fetch('/api/tags', { ...json({ path: 'Places' }), cookie: admin })).json()) as { keyword: { id: string } }).keyword

    const moved = await h.fetch(`/api/tags/${trip.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Norway', parentId: placesId }), cookie: admin })
    expect(await moved.json()).toMatchObject({ keyword: { path: 'Places › Norway' }, photos: 1 })
    expect((await tagsOf(ids[0]!))[0]!.path).toBe('Places › Norway › Bergen')
    expect(await total('q=trips')).toBe(0)
    expect(await total('q=places')).toBe(1)

    // No moving a keyword inside itself, and no silent clash with an existing path.
    const bergen = await byPath('Places › Norway › Bergen')
    expect((await h.fetch(`/api/tags/${trip.id}`, { method: 'PATCH', body: JSON.stringify({ parentId: bergen.id }), cookie: admin })).status).toBe(409)
    await h.fetch('/api/tags', { ...json({ path: 'Places > Norway > Oslo' }), cookie: admin })
    expect((await h.fetch(`/api/tags/${bergen.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Oslo' }), cookie: admin })).status).toBe(409)
  })

  it('merges keywords (children included) and deletes branches', async () => {
    await patch(ids[0]!, { tags: ['Norge > Bergen'] })
    await patch(ids[1]!, { tags: ['Norway > Bergen', 'Norway > Oslo'] })
    await patch(ids[2]!, { tags: ['Norge'] })
    const norge = await byPath('Norge')
    const norway = await byPath('Norway')
    const merged = await h.fetch(`/api/tags/${norge.id}/merge`, { ...json({ into: norway.id }), cookie: admin })
    expect(merged.status).toBe(200)
    const after = await tree()
    expect(after.map((k) => k.path)).toEqual(['Norway', 'Norway › Bergen', 'Norway › Oslo'])
    expect(after.find((k) => k.path === 'Norway')).toMatchObject({ count: 1, total: 3 })
    expect(await total('q=norge')).toBe(0)

    const res = await h.fetch(`/api/tags/${norway.id}`, { method: 'DELETE', cookie: admin })
    expect(await res.json()).toEqual({ photos: 3 })
    expect(await tree()).toEqual([])
    expect(await tagsOf(ids[1]!)).toEqual([])
  })

  it('merges a keyword into its parent without losing what is below it', async () => {
    // People › Smith › Smith › Anna, merged into People: Anna and its photo stay.
    await patch(ids[0]!, { tags: ['People > Smith > Smith > Anna'] })
    await patch(ids[1]!, { tags: ['People > Smith'] })
    const smith = await byPath('People › Smith')
    const people = await byPath('People')
    expect((await h.fetch(`/api/tags/${smith.id}/merge`, { ...json({ into: people.id }), cookie: admin })).status).toBe(200)
    expect((await tree()).map((k) => k.path)).toEqual(['People', 'People › Smith', 'People › Smith › Anna'])
    expect((await tagsOf(ids[0]!)).map((t) => t.path)).toEqual(['People › Smith › Anna'])
    expect((await tagsOf(ids[1]!)).map((t) => t.path)).toEqual(['People'])
  })

  it('handles names outside A–Z: accents fold, emoji rename and move', async () => {
    await patch(ids[0]!, { tags: ['ÖSTERREICH'] })
    await patch(ids[1]!, { tags: ['österreich'] })
    expect((await tree()).map((k) => k.path)).toEqual(['ÖSTERREICH'])
    expect(await total(`tag=${encodeURIComponent('Österreich')}`)).toBe(2)

    await patch(ids[2]!, { tags: ['Trips 🏔️ > Alps 🏔️ > Zermatt'] })
    const alps = await byPath('Trips 🏔️ › Alps 🏔️')
    expect((await h.fetch(`/api/tags/${alps.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Alpen 🇨🇭' }), cookie: admin })).status).toBe(200)
    expect((await tagsOf(ids[2]!)).map((t) => t.path)).toEqual(['Trips 🏔️ › Alpen 🇨🇭 › Zermatt'])
    const top = await byPath('ÖSTERREICH')
    expect((await h.fetch(`/api/tags/${alps.id}`, { method: 'PATCH', body: JSON.stringify({ parentId: top.id }), cookie: admin })).status).toBe(200)
    expect((await tagsOf(ids[2]!)).map((t) => t.path)).toEqual(['ÖSTERREICH › Alpen 🇨🇭 › Zermatt'])
    expect(await total(`tag=${encodeURIComponent('Österreich')}`)).toBe(3)
    expect((await h.fetch(`/api/tags/${alps.id}`, { method: 'DELETE', cookie: admin })).status).toBe(200)
    expect((await tree()).map((k) => k.path)).toEqual(['Trips 🏔️', 'ÖSTERREICH'])
  })

  it('links facets to one keyword exactly, by id, so renames keep saved searches', async () => {
    await patch(ids[0]!, { tags: ['Smith'] })
    await patch(ids[1]!, { tags: ['People > Smith'] })
    const top = await byPath('Smith')
    // A typed name means every Smith; the facet means that one.
    expect(await total('tag=Smith')).toBe(2)
    expect(await total(`kw=${top.id}`)).toBe(1)
    const saved = await h.fetch('/api/saved-searches', { ...json({ name: 'Smiths', query: `kw=${top.id}` }), cookie: admin })
    expect(saved.status).toBe(201)
    await h.fetch(`/api/tags/${top.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Smith family' }), cookie: admin })
    const list = (await (await h.fetch('/api/saved-searches', { cookie: admin })).json()) as { searches: { name: string; count: number }[] }
    expect(list.searches).toEqual([expect.objectContaining({ name: 'Smiths', count: 1 })])

    // Many saved searches: counted a few to a statement, each right.
    // 80 of them, two bound values each: more than one statement's worth.
    await h.env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 79)
       INSERT INTO saved_searches (id, name, query, position, created_by, created_at)
       SELECT 'ss' || i, 'S' || printf('%02d', i), CASE WHEN i % 2 THEN ? ELSE 'tag=Smith&rating=0' END, i + 1, NULL, '2026-01-01' FROM n`,
    )
      .bind(`kw=${top.id}&rating=1`)
      .run()
    const many = (await (await h.fetch('/api/saved-searches', { cookie: admin })).json()) as { searches: { name: string; count: number }[] }
    expect(many.searches).toHaveLength(81)
    expect(many.searches.find((s) => s.name === 'S79')?.count).toBe(0)
    // (A typed name follows the name: since the rename, only People › Smith is a Smith.)
    expect(many.searches.find((s) => s.name === 'S00')?.count).toBe(1)
    expect(many.searches.find((s) => s.name === 'S01')?.count).toBe(0)

    // Removing more keywords than D1 binds values in one go.
    const lots = Array.from({ length: 120 }, (_, i) => `k${i}`)
    await patch(ids[2]!, { tags: lots })
    const removed = await h.fetch('/api/assets/bulk', { ...json({ ids: [ids[2]], action: 'tag-remove', tags: lots }), cookie: admin })
    expect(removed.status).toBe(200)
    expect(await tagsOf(ids[2]!)).toEqual([])
  })

  it('counts a big keyword tree quickly', async () => {
    // 2,000 keywords three deep, 300 photos with 100 keywords each (30,000 tag rows).
    const db = h.env.DB
    const now = new Date().toISOString()
    await db.batch([
      db.prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 19)
         INSERT INTO tags (id, name, name_key, parent_id, path, full_path, created_at) SELECT 'a' || i, 'A' || i, 'a' || i, NULL, 'a' || i, 'A' || i, ? FROM n`,
      ).bind(now),
      db.prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 199)
         INSERT INTO tags (id, name, name_key, parent_id, path, full_path, created_at) SELECT 'b' || i, 'B' || i, 'b' || i, 'a' || (i % 20), 'a' || (i % 20) || '|b' || i, 'A' || (i % 20) || '|B' || i, ? FROM n`,
      ).bind(now),
      db.prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 1779)
         INSERT INTO tags (id, name, name_key, parent_id, path, full_path, created_at)
         SELECT 'c' || i, 'C' || i, 'c' || i, 'b' || (i % 200), 'a' || ((i % 200) % 20) || '|b' || (i % 200) || '|c' || i, 'A' || ((i % 200) % 20) || '|B' || (i % 200) || '|C' || i, ? FROM n`,
      ).bind(now),
      db.prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 299)
         INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) SELECT 'p' || i, 'p' || i || '.jpg', 'image/jpeg', 1, 'ready', ?, ? FROM n`,
      ).bind(now, now),
      db.prepare(
        `WITH RECURSIVE p(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM p WHERE i < 299), k(j) AS (SELECT 0 UNION ALL SELECT j + 1 FROM k WHERE j < 99)
         INSERT INTO asset_tags (asset_id, tag_id, source, created_at) SELECT 'p' || i, 'c' || ((i * 7 + j * 13) % 1780), 'import', ? FROM p, k`,
      ).bind(now),
    ])
    const started = Date.now()
    const keywords = await tree()
    expect(keywords).toHaveLength(2000)
    expect(keywords.find((k) => k.path === 'A0')!.total).toBeGreaterThan(0)
    const facets = (await (await h.fetch('/api/assets/facets', { cookie: admin })).json()) as { tag: unknown[] }
    expect(facets.tag.length).toBeGreaterThan(100)
    expect(await total(`kw=a3`)).toBeGreaterThan(0)
    expect(await total('tag=B7')).toBeGreaterThan(0)
    expect(Date.now() - started).toBeLessThan(15_000)
  })

  it('makes synonyms searchable and exports keywords the way Lightroom does', async () => {
    await patch(ids[0]!, { tags: ['Places > Europe > Norway > Bergen', 'Clients > Smith Wedding'] })
    const bergen = await byPath('Places › Europe › Norway › Bergen')
    await h.fetch(`/api/tags/${bergen.id}`, { method: 'PATCH', body: JSON.stringify({ synonyms: ['Bjørgvin'] }), cookie: admin })
    expect(await total('q=bjørgvin')).toBe(1)
    // Container keywords people don't want in exported files.
    for (const path of ['Places', 'Clients']) {
      const k = await byPath(path)
      await h.fetch(`/api/tags/${k.id}`, { method: 'PATCH', body: JSON.stringify({ includeOnExport: false }), cookie: admin })
    }
    const text = await xmp(ids[0]!)
    const subjects = /<dc:subject><rdf:Bag>(.*?)<\/rdf:Bag>/.exec(text)![1]!.match(/<rdf:li>(.*?)<\/rdf:li>/g)!.map((li) => li.slice(8, -9))
    expect(subjects.sort()).toEqual(['Bergen', 'Bjørgvin', 'Europe', 'Norway', 'Smith Wedding'])
    expect(text).toContain('<lr:hierarchicalSubject><rdf:Bag><rdf:li>Clients|Smith Wedding</rdf:li><rdf:li>Places|Europe|Norway|Bergen</rdf:li></rdf:Bag></lr:hierarchicalSubject>')
  })

  it('reindexes big changes through the sweep', async () => {
    await patch(ids[0]!, { tags: ['Old name'] })
    await h.env.DB.prepare('DELETE FROM assets_fts').run()
    expect(await total('q=old')).toBe(0)
    await runSweep(h.env)
    expect(await total('q=old')).toBe(1)
  })
})

describe('colour labels', () => {
  it('sets, filters, counts and exports labels under their archive names', async () => {
    expect((await patch(ids[0]!, { label: 'red' })).status).toBe(200)
    expect((await patch(ids[0]!, { label: 'pink' })).status).toBe(400)
    const bulk = await h.fetch('/api/assets/bulk', { ...json({ ids: [ids[1], ids[2]], action: 'label', label: 'green' }), cookie: admin })
    expect(await bulk.json()).toEqual({ changed: 2 })
    expect(await total('label=green')).toBe(2)
    expect(await total('label=none')).toBe(0)
    const facets = (await (await h.fetch('/api/assets/facets', { cookie: admin })).json()) as { label: { value: string; count: number }[] }
    expect(facets.label).toEqual([{ value: 'red', count: 1 }, { value: 'green', count: 2 }])
    const list = (await (await h.fetch('/api/assets?label=red', { cookie: admin })).json()) as { assets: { label: string }[] }
    expect(list.assets[0]!.label).toBe('red')

    expect(await xmp(ids[0]!)).toContain('xmp:Label="Red"')
    await h.fetch('/api/labels', { method: 'PUT', body: JSON.stringify({ red: 'To edit' }), cookie: admin })
    expect(await xmp(ids[0]!)).toContain('xmp:Label="To edit"')
    expect(((await (await h.fetch('/api/labels', { cookie: admin })).json()) as { names: Record<string, string> }).names).toMatchObject({ red: 'To edit', green: 'Green' })
  })
})
