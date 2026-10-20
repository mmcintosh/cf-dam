import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cookiesFrom, createHarness, createUser, json, setUpAdmin, signIn, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

let h: Harness
let admin: string
let ids: string[]

/** Upload one file through the R2 path and return its asset id. */
async function upload(filename: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: bytes.byteLength }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  ids = []
  for (const name of ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']) ids.push(await upload(name, camera))
  // Vary what the files say about themselves (all four started as the same camera file).
  const set = (id: string, sql: string, ...params: unknown[]) => h.env.DB.prepare(`UPDATE assets SET ${sql} WHERE id = ?`).bind(...params, id).run()
  await set(ids[1]!, "captured_at = '2023-03-10T09:00:00', camera_model = 'Nikon Z 8', width = 800, height = 1200")
  await set(ids[2]!, "captured_at = '2023-07-01T12:00:00', mime_type = 'image/x-canon-cr3'")
  await set(ids[3]!, "captured_at = NULL, width = 1000, height = 1000")
})
afterEach(async () => h.dispose())

const list = async (query: string) =>
  ((await (await h.fetch(`/api/assets?${query}`, { cookie: admin })).json()) as { assets: { id: string }[]; total: number })

describe('filters', () => {
  it('narrows by year, month, camera, orientation, file type and undated', async () => {
    expect((await list('year=2024')).total).toBe(1)
    expect((await list('year=2023')).total).toBe(2)
    expect((await list('month=2023-07')).assets.map((a) => a.id)).toEqual([ids[2]])
    expect((await list('camera=Nikon%20Z%208')).assets.map((a) => a.id)).toEqual([ids[1]])
    expect((await list('orientation=portrait')).assets.map((a) => a.id)).toEqual([ids[1]])
    expect((await list('orientation=square')).assets.map((a) => a.id)).toEqual([ids[3]])
    expect((await list('type=raw')).assets.map((a) => a.id)).toEqual([ids[2]])
    expect((await list('year=undated')).assets.map((a) => a.id)).toEqual([ids[3]])
    expect((await list('tier=hot')).total).toBe(4)
    expect((await list('tier=deep')).total).toBe(0)
  })

  it('ignores filter values it does not recognise rather than failing', async () => {
    expect((await list('orientation=diagonal&year=20x4&rating=9')).total).toBe(4)
  })
})

describe('facets', () => {
  it('counts each dimension, ignoring that dimension’s own selection', async () => {
    const f = (await (await h.fetch('/api/assets/facets?year=2023', { cookie: admin })).json()) as Record<string, { value: string; count: number }[]>
    // The year facet still offers every year while 2023 is selected...
    expect(f.year).toEqual([
      { value: '2024', count: 1 },
      { value: '2023', count: 2 },
      { value: 'undated', count: 1 },
    ])
    // ...while the other facets count only 2023.
    expect(f.camera!.sort((a, b) => a.value.localeCompare(b.value))).toEqual([
      { value: 'Canon EOS R5', count: 1 },
      { value: 'Nikon Z 8', count: 1 },
    ])
    expect(f.type!.sort((a, b) => a.value.localeCompare(b.value))).toEqual([
      { value: 'photo', count: 1 },
      { value: 'raw', count: 1 },
    ])
  })

  it('builds a timeline by month', async () => {
    const { months } = (await (await h.fetch('/api/assets/timeline', { cookie: admin })).json()) as { months: { month: string; count: number }[] }
    expect(months).toEqual([
      { month: '2023-03', count: 1 },
      { month: '2023-07', count: 1 },
      { month: '2024-06', count: 1 },
    ])
  })

  it('returns map points for GPS-tagged photos', async () => {
    const { points } = (await (await h.fetch('/api/assets/geo', { cookie: admin })).json()) as { points: { lat: number }[] }
    expect(points).toHaveLength(4)
    expect(points[0]!.lat).toBeCloseTo(62.4667, 3)
  })
})

describe('bulk actions', () => {
  const bulk = (body: unknown, cookie = admin) => h.fetch('/api/assets/bulk', { ...json(body), cookie })

  it('tags, rates, flags and titles many assets at once, and search sees it', async () => {
    const two = ids.slice(0, 2)
    expect(await (await bulk({ ids: two, action: 'tag-add', tags: ['Wedding', 'Bergen'] })).json()).toEqual({ changed: 2 })
    await bulk({ ids: two, action: 'rating', rating: 4 })
    await bulk({ ids: [ids[0]], action: 'flag', flag: 'pick' })
    await bulk({ ids: [ids[1]], action: 'flag', flag: 'reject' })
    await bulk({ ids: two, action: 'title', title: 'Solveig & Arne' })

    expect((await list('tag=Bergen')).total).toBe(2)
    expect((await list('rating=4')).total).toBe(2)
    expect((await list('flag=pick')).assets.map((a) => a.id)).toEqual([ids[0]])
    expect((await list('flag=none')).total).toBe(2)
    expect((await list('q=solveig')).total).toBe(2)

    await bulk({ ids: two, action: 'tag-remove', tags: ['Bergen'] })
    expect((await list('tag=Bergen')).total).toBe(0)
    expect((await list('tag=Wedding')).total).toBe(2)
  })

  it('adds a selection to an album and deletes a selection', async () => {
    const { album } = (await (await h.fetch('/api/albums', { ...json({ name: 'Picks' }), cookie: admin })).json()) as { album: { id: string } }
    await bulk({ ids, action: 'album-add', albumId: album.id })
    expect((await list(`album=${album.id}`)).total).toBe(4)
    await bulk({ ids: ids.slice(2), action: 'delete' })
    expect((await list('')).total).toBe(2)
  })

  it('checks the permission each action needs', async () => {
    await createUser(h, admin, { name: 'E', email: 'e@example.com', password: 'editor password 1', roles: ['editor'] })
    await createUser(h, admin, { name: 'V', email: 'v@example.com', password: 'viewer password 1', roles: ['viewer'] })
    const viewer = cookiesFrom(await signIn(h, 'v@example.com', 'viewer password 1'))
    expect((await bulk({ ids, action: 'rating', rating: 5 }, viewer)).status).toBe(403)
    expect((await bulk({ ids, action: 'nonsense' })).status).toBe(400)
    expect((await bulk({ ids: [], action: 'rating', rating: 5 })).status).toBe(400)
  })
})

describe('rename and XMP', () => {
  it('renames for display and download, refusing slashes', async () => {
    const ok = await h.fetch(`/api/assets/${ids[0]}`, { method: 'PATCH', body: JSON.stringify({ filename: 'Solveig-first-look.jpg' }), cookie: admin })
    expect(ok.status).toBe(200)
    const original = await h.fetch(`/api/assets/${ids[0]}/original`, { cookie: admin })
    expect(original.headers.get('content-disposition')).toContain('Solveig-first-look.jpg')
    const bad = await h.fetch(`/api/assets/${ids[0]}`, { method: 'PATCH', body: JSON.stringify({ filename: '../etc/passwd' }), cookie: admin })
    expect(bad.status).toBe(400)
  })

  it('writes an XMP sidecar Lightroom can read, named after the original', async () => {
    await h.fetch(`/api/assets/${ids[0]}`, {
      method: 'PATCH',
      body: JSON.stringify({ filename: 'IMG_2041.CR3', title: 'Fjord & dawn', caption: 'First light <Geiranger>', rating: 4, tags: ['Norway', 'fjord'] }),
      cookie: admin,
    })
    const res = await h.fetch(`/api/assets/${ids[0]}/xmp`, { cookie: admin })
    expect(res.headers.get('content-disposition')).toContain('IMG_2041.xmp')
    const xmp = await res.text()
    expect(xmp).toContain('xmp:Rating="4"')
    expect(xmp).toContain('<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Fjord &amp; dawn</rdf:li></rdf:Alt></dc:title>')
    expect(xmp).toContain('First light &lt;Geiranger&gt;')
    expect(xmp).toContain('<dc:subject><rdf:Bag><rdf:li>fjord</rdf:li><rdf:li>Norway</rdf:li></rdf:Bag></dc:subject>')
    expect(xmp).toContain('photoshop:DateCreated="2024-06-15T18:42:07"')
  })
})
