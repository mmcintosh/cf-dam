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
