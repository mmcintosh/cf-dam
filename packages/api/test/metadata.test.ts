import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))
const iptc = new Uint8Array(readFileSync(new URL('./fixtures/iptc.jpg', import.meta.url)))

let h: Harness
let admin: string

async function upload(filename: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: bytes.byteLength, allowDuplicate: true }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

interface AssetBody {
  label: string | null
  iptc: Record<string, string | null>
  locationSource: string | null
  tags: { path: string; source: string }[]
}
const asset = async (id: string) => (await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as AssetBody
const total = async (query: string) => ((await (await h.fetch(`/api/assets?${query}`, { cookie: admin })).json()) as { total: number }).total
const patch = (id: string, body: unknown) => h.fetch(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body), cookie: admin })

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

describe('IPTC Core', () => {
  it('reads credit, rights, contact and place from the file, with Lightroom keyword paths and label', async () => {
    const id = await upload('bergen.jpg', iptc)
    const a = await asset(id)
    expect(a.iptc).toMatchObject({
      headline: 'Storm over Bergen',
      creator: 'Mark Photographer',
      creatorTitle: 'Owner',
      credit: 'Mark Photo AS',
      source: 'Studio archive',
      copyright: '© 2024 Mark Photo AS',
      usageTerms: 'Editorial use only',
      copyrightUrl: 'https://example.com/licence',
      contactEmail: 'mark@example.com',
      contactPhone: '+47 555 0100',
      contactUrl: 'https://example.com',
      jobId: 'JOB-2041',
      instructions: 'No crop',
      sublocation: 'Bryggen',
      city: 'Bergen',
      state: 'Vestland',
      country: 'Norway',
      countryCode: 'NO',
    })
    expect(a.locationSource).toBe('file')
    expect(a.label).toBe('red')
    // The hierarchical keyword becomes a path; the flat "Bergen" it implies isn't added again at the top.
    expect(a.tags.map((t) => t.path)).toEqual(['Places › Norway › Bergen'])

    expect(await total('q=bryggen')).toBe(1)
    expect(await total('q=vestland')).toBe(1)
    expect(await total('q=photographer')).toBe(1)
    expect(await total('q=JOB-2041')).toBe(1)
    expect(await total('city=Bergen')).toBe(1)
    expect(await total('country=Norway&creator=Mark%20Photographer')).toBe(1)
    const facets = (await (await h.fetch('/api/assets/facets', { cookie: admin })).json()) as Record<string, { value: string; count: number }[]>
    expect(facets.country).toEqual([{ value: 'Norway', count: 1 }])
    expect(facets.city).toEqual([{ value: 'Bergen', count: 1 }])
  })

  it('edits fields, validates them, and writes them to the XMP sidecar', async () => {
    const id = await upload('a.jpg', camera)
    expect((await patch(id, { iptc: { city: 'Ålesund', country: 'Norway', usageTerms: 'All rights reserved', contactEmail: 'a@b.no' } })).status).toBe(200)
    expect((await asset(id)).locationSource).toBe('user')
    expect((await patch(id, { iptc: { countryCode: 'NORWAY' } })).status).toBe(400)
    expect((await patch(id, { iptc: { city: 42 } })).status).toBe(400)
    expect((await patch(id, { iptc: { city: '' } })).status).toBe(200)
    expect((await asset(id)).iptc.city).toBeNull()

    const xmp = await (await h.fetch(`/api/assets/${id}/xmp`, { cookie: admin })).text()
    expect(xmp).toContain('photoshop:Country="Norway"')
    expect(xmp).toContain('<dc:creator><rdf:Seq><rdf:li>Test Photographer</rdf:li></rdf:Seq></dc:creator>')
    expect(xmp).toContain('<xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">All rights reserved</rdf:li></rdf:Alt></xmpRights:UsageTerms>')
    expect(xmp).toContain('<Iptc4xmpCore:CiEmailWork>a@b.no</Iptc4xmpCore:CiEmailWork>')
  })
})

describe('metadata presets', () => {
  it('stamps fields on a selection, filling gaps unless told to overwrite, and on new uploads', async () => {
    const a = await upload('a.jpg', camera) // the file says creator "Test Photographer", copyright "(c) Test"
    const b = await upload('b.jpg', iptc)
    const res = await h.fetch('/api/presets', { ...json({ name: 'Studio', fields: { copyright: '© Studio AS', credit: 'Studio AS', usageTerms: 'Licence required' } }), cookie: admin })
    expect(res.status).toBe(201)
    const { preset } = (await res.json()) as { preset: { id: string } }
    expect((await h.fetch('/api/presets', { ...json({ name: 'Empty', fields: {} }), cookie: admin })).status).toBe(400)

    const bulk = (body: unknown) => h.fetch('/api/assets/bulk', { ...json({ ids: [a, b], action: 'preset', presetId: preset.id, ...(body as object) }), cookie: admin })
    expect(await (await bulk({})).json()).toEqual({ changed: 2 })
    expect((await asset(a)).iptc).toMatchObject({ copyright: '(c) Test', credit: 'Studio AS', usageTerms: 'Licence required' })
    expect((await asset(b)).iptc).toMatchObject({ copyright: '© 2024 Mark Photo AS', credit: 'Mark Photo AS', usageTerms: 'Editorial use only' })
    await bulk({ overwrite: true })
    expect((await asset(b)).iptc).toMatchObject({ copyright: '© Studio AS', credit: 'Studio AS' })
    expect(await total('q=licence')).toBe(0) // usage terms aren't searchable; credit is
    expect(await total('q=studio')).toBe(2)

    await h.fetch(`/api/presets/${preset.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Studio', fields: { credit: 'Studio AS', jobId: 'AUTO' }, applyToUploads: true }), cookie: admin })
    const c = await upload('c.jpg', camera)
    expect((await asset(c)).iptc).toMatchObject({ credit: 'Studio AS', jobId: 'AUTO', copyright: '(c) Test' })
  })
})

describe('saved searches', () => {
  it('saves a cleaned-up filter with a live count', async () => {
    await upload('a.jpg', camera)
    await upload('b.jpg', iptc)
    const res = await h.fetch('/api/saved-searches', { ...json({ name: 'Bergen', query: '?city=Bergen&offset=40&nonsense=1&rating=9' }), cookie: admin })
    expect(res.status).toBe(201)
    const { search } = (await res.json()) as { search: { id: string; query: string } }
    expect(search.query).toBe('city=Bergen')
    expect((await h.fetch('/api/saved-searches', { ...json({ name: 'Nothing', query: 'offset=10' }), cookie: admin })).status).toBe(400)

    const list = (await (await h.fetch('/api/saved-searches', { cookie: admin })).json()) as { searches: { name: string; count: number }[] }
    expect(list.searches).toEqual([expect.objectContaining({ name: 'Bergen', count: 1, query: 'city=Bergen' })])
    await h.fetch(`/api/saved-searches/${search.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Bergen trips' }), cookie: admin })
    await h.fetch(`/api/saved-searches/${search.id}`, { method: 'DELETE', cookie: admin })
    expect(((await (await h.fetch('/api/saved-searches', { cookie: admin })).json()) as { searches: unknown[] }).searches).toEqual([])
  })
})
