import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { needsAttention, sweepShot } from '../src/catalog/jobs'
import { cookiesFrom, createHarness, createUser, json, setUpAdmin, signIn, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

let h: Harness
let admin: string
let ids: string[]
let clientId: string

async function upload(filename: string): Promise<string> {
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}
const taken = (id: string, at: string | null) => h.env.DB.prepare('UPDATE assets SET captured_at = ? WHERE id = ?').bind(at, id).run()

interface Job {
  id: string
  title: string
  stage: string
  deliveredAt: string | null
  albums: number
  client: { id: string; name: string }
}
const job = async (id: string) => (await (await h.fetch(`/api/jobs/${id}`, { cookie: admin })).json()) as { job: Job; albums: { id: string; name: string; photos: number }[]; galleries: { id: string; finalDelivery: boolean }[] }
const create = async (body: Record<string, unknown>) => {
  const response = await h.fetch('/api/jobs', { ...json({ clientId, ...body }), cookie: admin })
  expect(response.status, await response.clone().text()).toBe(201)
  return (await response.json()) as { job: Job; album: { albumId: string; photos: number } | null }
}

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  ids = [await upload('a.jpg'), await upload('b.jpg'), await upload('c.jpg'), await upload('d.jpg')]
  // Two on the wedding day, one the day after, one months later.
  await taken(ids[0]!, '2024-06-14T13:05:00')
  await taken(ids[1]!, '2024-06-14T23:40:00')
  await taken(ids[2]!, '2024-06-15T00:10:00')
  await taken(ids[3]!, '2024-09-01T10:00:00')
  clientId = ((await (await h.fetch('/api/clients', { ...json({ name: 'Anna and Tom Hansen' }), cookie: admin })).json()) as { client: { id: string } }).client.id
})
afterEach(async () => h.dispose())

describe('jobs', () => {
  it('is for administrators only, and checks what it is sent', async () => {
    await createUser(h, admin, { name: 'Eddie Editor', email: 'eddie@example.com', password: 'an editor password', roles: ['editor'] })
    const editor = cookiesFrom(await signIn(h, 'eddie@example.com', 'an editor password'))
    expect((await h.fetch('/api/jobs', { cookie: editor })).status).toBe(403)
    expect((await h.fetch('/api/jobs', { ...json({ clientId, title: '' }), cookie: admin })).status).toBe(400)
    expect((await h.fetch('/api/jobs', { ...json({ title: 'No client' }), cookie: admin })).status).toBe(400)
    expect((await h.fetch('/api/jobs', { ...json({ clientId, title: 'Backwards', shootStart: '2024-06-15', shootEnd: '2024-06-14' }), cookie: admin })).status).toBe(400)
    expect((await h.fetch('/api/jobs', { ...json({ clientId: 'nobody', title: 'Lost' }), cookie: admin })).status).toBe(404)

    // A link to the job in the photographer's CRM: a web address only, and '' takes it away.
    const { job: made } = await create({ title: 'Linked' })
    const edit = (crmUrl: string) => h.fetch(`/api/jobs/${made.id}`, { method: 'PATCH', body: JSON.stringify({ crmUrl }), cookie: admin })
    expect((await edit('javascript:alert(1)')).status).toBe(400)
    expect((await edit('not a link')).status).toBe(400)
    expect((await edit('https://app.honeybook.com/project/123')).status).toBe(200)
    expect(((await job(made.id)).job as Job & { crmUrl: string }).crmUrl).toBe('https://app.honeybook.com/project/123')
    expect((await edit('')).status).toBe(200)
    expect(((await job(made.id)).job as Job & { crmUrl: string }).crmUrl).toBe('')
  })

  it('makes a job from a Library filter, with an album of those photos, and a new client by name', async () => {
    const summary = await (await h.fetch(`/api/jobs/photos?query=${encodeURIComponent('from=2024-06-14&to=2024-06-15')}`, { cookie: admin })).json()
    expect(summary).toEqual({ photos: 3, first: '2024-06-14', last: '2024-06-15' })
    expect((await h.fetch(`/api/jobs/photos?query=${encodeURIComponent('meaning=wedding')}`, { cookie: admin })).status).toBe(400)

    const response = await h.fetch('/api/jobs', {
      ...json({ newClient: { name: 'Brücke GmbH' }, title: 'Product shoot', kind: 'commercial', shootStart: '2024-06-14', shootEnd: '2024-06-15', stage: 'shot', photos: { query: 'from=2024-06-14&to=2024-06-15' } }),
      cookie: admin,
    })
    expect(response.status).toBe(201)
    const made = (await response.json()) as { job: Job; album: { albumId: string; photos: number } }
    expect(made.job).toMatchObject({ stage: 'shot', albums: 1, client: { name: 'Brücke GmbH' } })
    expect(made.album.photos).toBe(3)
    // In the order they were taken.
    const items = await h.env.DB.prepare('SELECT asset_id FROM album_items WHERE album_id = ? ORDER BY position').bind(made.album.albumId).all<{ asset_id: string }>()
    expect(items.results.map((r) => r.asset_id)).toEqual([ids[0], ids[1], ids[2]])
    // Found by its client's name, without accents.
    const found = (await (await h.fetch('/api/jobs?q=brucke', { cookie: admin })).json()) as { jobs: Job[] }
    expect(found.jobs.map((j) => j.title)).toEqual(['Product shoot'])
  })

  it('moves Booked to Shot when photos from the shoot dates arrive, and only then', async () => {
    const wedding = (await create({ title: 'Hansen wedding', kind: 'wedding', shootStart: '2024-06-14' })).job
    const later = (await create({ title: 'Anniversary', shootStart: '2024-07-20' })).job
    expect(wedding.stage).toBe('booked')
    expect(await sweepShot(h.env.DB)).toEqual([{ id: wedding.id, title: 'Hansen wedding' }])
    expect((await job(wedding.id)).job.stage).toBe('shot')
    expect((await job(later.id)).job.stage).toBe('booked')
    // Nothing more to move.
    expect(await sweepShot(h.env.DB)).toEqual([])

    // A shoot more than three days ago with no photos needs attention.
    const attention = await needsAttention(h.env.DB, '2024-07-30')
    expect(attention).toEqual([expect.objectContaining({ kind: 'noPhotos', job: expect.objectContaining({ id: later.id }) })])
  })

  it('makes an album of the shoot dates, moves stages either way, and delivers with a final gallery', async () => {
    const wedding = (await create({ title: 'Hansen wedding', shootStart: '2024-06-14', dueOn: '2020-01-01', photos: 'dates' })).job
    let page = await job(wedding.id)
    // The 14th only, through midnight.
    expect(page.albums).toEqual([expect.objectContaining({ name: 'Hansen wedding', photos: 2 })])
    expect((await needsAttention(h.env.DB)).map((a) => a.kind)).toContain('overdue')

    // Forward, skipping proofing, and back.
    for (const stage of ['editing', 'final_edits', 'editing']) {
      expect((await h.fetch(`/api/jobs/${wedding.id}/stage`, { ...json({ stage }), cookie: admin })).status).toBe(200)
    }
    expect((await h.fetch(`/api/jobs/${wedding.id}/stage`, { ...json({ stage: 'archived' }), cookie: admin })).status).toBe(400)

    // A gallery ticked Final delivery delivers the job.
    const share = await h.fetch('/api/shares', { ...json({ albumId: page.albums[0]!.id, name: 'Your wedding', finalDelivery: true }), cookie: admin })
    expect(share.status).toBe(201)
    page = await job(wedding.id)
    expect(page.job).toMatchObject({ stage: 'delivered', deliveredAt: expect.any(String) })
    expect(page.galleries).toEqual([expect.objectContaining({ finalDelivery: true })])
    // Delivered work no longer needs attention for its due date.
    expect((await needsAttention(h.env.DB)).map((a) => a.kind)).not.toContain('overdue')

    // The history, in order: made, three moves, delivered.
    const history = (await (await h.fetch(`/api/activity?job=${wedding.id}`, { cookie: admin })).json()) as { entries: { action: string; details: { to?: string; by?: string } }[] }
    expect(history.entries.map((e) => [e.action, e.details?.to, e.details?.by]).reverse()).toEqual([
      ['job.created', undefined, undefined],
      ['job.stage', 'editing', undefined],
      ['job.stage', 'final_edits', undefined],
      ['job.stage', 'editing', undefined],
      ['job.stage', 'delivered', 'final_delivery'],
    ])

    // The client's page shows the job's gallery, though no login was invited to it.
    const client = (await (await h.fetch(`/api/clients/${clientId}`, { cookie: admin })).json()) as { client: { openGalleries: number }; galleries: { name: string }[] }
    expect(client.galleries.map((g) => g.name)).toEqual(['Your wedding'])
    expect(client.client.openGalleries).toBe(1)
  })

  it('keeps albums when a job is deleted or its client erased', async () => {
    const one = await create({ title: 'Portraits', shootStart: '2024-09-01', photos: 'dates' })
    const two = await create({ title: 'Wedding', shootStart: '2024-06-14', photos: 'dates' })
    expect((await h.fetch(`/api/jobs/${one.job.id}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    expect(await h.env.DB.prepare('SELECT job_id FROM albums WHERE id = ?').bind(one.album!.albumId).first()).toEqual({ job_id: null })

    expect((await h.fetch(`/api/clients/${clientId}/erase`, { ...json({ confirm: 'Anna and Tom Hansen' }), cookie: admin })).status).toBe(200)
    expect((await h.fetch(`/api/jobs/${two.job.id}`, { cookie: admin })).status).toBe(404)
    expect(await h.env.DB.prepare('SELECT job_id FROM albums WHERE id = ?').bind(two.album!.albumId).first()).toEqual({ job_id: null })
    expect(await h.env.DB.prepare('SELECT COUNT(*) AS n FROM album_items WHERE album_id = ?').bind(two.album!.albumId).first()).toEqual({ n: 2 })
  })
})
