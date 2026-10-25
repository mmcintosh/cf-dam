import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { facets } from '../src/catalog/library'
import { indexAssets } from '../src/catalog/search'
import { peopleInFile } from '../src/catalog/metadata'
import { normalizeAgentMetadata } from '../src/catalog/metadata'
import { metadataLookups, metadataStatements } from '../src/catalog/process'
import { createHarness, createUser, cookiesFrom, json, setUpAdmin, signIn, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

let h: Harness
let admin: string
let ids: string[]

async function upload(filename: string): Promise<string> {
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  ids = [await upload('a.jpg'), await upload('b.jpg'), await upload('c.jpg')]
})
afterEach(async () => {
  await h?.dispose()
})

const bulk = (body: Record<string, unknown>, cookie = admin) => h.fetch('/api/assets/bulk', { ...json(body), cookie })
const list = async (query: string) => ((await (await h.fetch(`/api/assets?${query}`, { cookie: admin })).json()) as { assets: { id: string }[] }).assets.map((a) => a.id).sort()

describe('people named by hand (plans/PLAN-FN-v2.md FN1)', () => {
  it('tags photos with people, finds them by filter, facet and search, and keeps names one per person', async () => {
    const anna = ((await (await h.fetch('/api/people', { ...json({ name: '  Anna   Hansen ' }), cookie: admin })).json()) as { person: { id: number; name: string } }).person
    expect(anna.name).toBe('Anna Hansen')
    // The same name however it's typed is the same person.
    expect((await (await h.fetch('/api/people', { ...json({ name: 'anna hansen' }), cookie: admin })).json()) as { created: boolean }).toMatchObject({ created: false })
    expect((await bulk({ ids: [ids[0], ids[1]], action: 'person', personId: anna.id })).status).toBe(200)
    // A new name from the selection bar makes the person.
    expect((await bulk({ ids: [ids[1]], action: 'person', name: 'Tom Hansen' })).status).toBe(200)
    const tom = ((await (await h.fetch('/api/people?q=tom', { cookie: admin })).json()) as { people: { id: number; photos: number }[] }).people[0]!
    expect(tom.photos).toBe(1)

    expect(await list(`person=${anna.id}`)).toEqual([ids[0], ids[1]].sort())
    expect(await list(`person=${anna.id},${tom.id}`)).toEqual([ids[1]])
    const f = await facets(h.env.DB, {})
    expect(f.named).toEqual([{ id: anna.id, name: 'Anna Hansen', count: 2 }, { id: tom.id, name: 'Tom Hansen', count: 1 }])

    await indexAssets(h.env.DB, ids)
    expect(await list('q=hansen')).toEqual([ids[0], ids[1]].sort())
    expect(await list('q=tom')).toEqual([ids[1]])

    expect(await (await h.fetch(`/api/people/photo/${ids[1]}`, { cookie: admin })).json()).toEqual({
      people: [
        { id: anna.id, name: 'Anna Hansen', how: 'hand' },
        { id: tom.id, name: 'Tom Hansen', how: 'hand' },
      ],
    })
    await bulk({ ids: [ids[1]], action: 'person', personId: anna.id, add: false })
    expect(await list(`person=${anna.id}`)).toEqual([ids[0]])
  })

  it('renames (not onto another name), merges, and deletes, with Activity naming nobody', async () => {
    const make = async (name: string) => ((await (await h.fetch('/api/people', { ...json({ name }), cookie: admin })).json()) as { person: { id: number } }).person.id
    const a = await make('Anna')
    const b = await make('Anne')
    await bulk({ ids: [ids[0]], action: 'person', personId: a })
    await bulk({ ids: [ids[0], ids[1]], action: 'person', personId: b })
    const patch = (id: number, body: Record<string, unknown>) => h.fetch(`/api/people/${id}`, { method: 'PATCH', body: JSON.stringify(body), cookie: admin })
    expect((await patch(b, { name: 'anna' })).status).toBe(409)
    expect((await patch(b, { name: 'Anne Smith', isChild: true, notes: 'Bride' })).status).toBe(200)
    const merged = (await (await h.fetch(`/api/people/${b}/merge`, { ...json({ into: a }), cookie: admin })).json()) as { person: { photos: number }; moved: number }
    expect(merged).toMatchObject({ person: { photos: 2 }, moved: 2 })
    expect((await h.fetch(`/api/people/${b}`, { cookie: admin })).status).toBe(404)
    expect((await h.fetch(`/api/people/${a}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    expect(await h.env.DB.prepare('SELECT COUNT(*) AS n FROM asset_people').first()).toEqual({ n: 0 })
    const log = await h.env.DB.prepare("SELECT details FROM activity_log WHERE action LIKE 'person.%'").all<{ details: string | null }>()
    expect(log.results.map((r) => r.details ?? '').join()).not.toMatch(/Ann/)
  })

  it('lets viewers see names but not change them', async () => {
    await createUser(h, admin, { name: 'Vera Viewer', email: 'vera@example.com', password: 'a viewer password', roles: ['viewer'] })
    const vera = cookiesFrom(await signIn(h, 'vera@example.com', 'a viewer password'))
    await bulk({ ids: [ids[0]], action: 'person', name: 'Anna' })
    expect((await h.fetch('/api/people', { cookie: vera })).status).toBe(200)
    expect((await h.fetch('/api/people', { ...json({ name: 'Eve' }), cookie: vera })).status).toBe(403)
    expect((await bulk({ ids: [ids[0]], action: 'person', name: 'Eve' }, vera)).status).toBe(400)
  })

  it('reads names Lightroom wrote into files, and tags them as from the file', async () => {
    expect(peopleInFile({ PersonInImage: ['Anna Hansen', 'Tom'], RegionInfo: { RegionList: [{ Name: 'Tom', Type: 'Face' }, { Name: 'Sign', Type: 'Focus' }, { Name: 'Max', Type: 'Face' }] } })).toEqual(['Anna Hansen', 'Tom', 'Max'])
    const meta = normalizeAgentMetadata({ keywords: [], people: ['Anna Hansen', ' Max '] })!
    expect(meta.people).toEqual(['Anna Hansen', 'Max'])
    await h.env.DB.batch(metadataStatements(h.env.DB, ids[2]!, meta, await metadataLookups(h.env.DB, [meta])))
    expect(await (await h.fetch(`/api/people/photo/${ids[2]}`, { cookie: admin })).json()).toMatchObject({ people: [{ name: 'Anna Hansen', how: 'file' }, { name: 'Max', how: 'file' }] })
  })
})
