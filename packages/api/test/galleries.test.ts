import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSweep, SLICES } from '../src/catalog/sweeper'
import { cookiesFrom, createHarness, createUser, json, setUpAdmin, signIn, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))
const gradient = new Uint8Array(readFileSync(new URL('./fixtures/gradient.png', import.meta.url)))

let h: Harness
let admin: string
let ids: string[]
let albumId: string

async function upload(filename: string): Promise<string> {
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

interface Share {
  id: string
  token: string
  status: string
  hasPassword: boolean
  stats: { opens: number; visitors: number; picks: number; downloads: number }
}

async function share(body: Record<string, unknown> = {}): Promise<Share> {
  const response = await h.fetch('/api/shares', { ...json({ albumId, name: 'For the Smiths', ...body }), cookie: admin })
  expect(response.status).toBe(201)
  return ((await response.json()) as { share: Share }).share
}

const gallery = (token: string, path = '', init: Parameters<Harness['fetch']>[1] = {}) => h.fetch(`/api/public/galleries/${token}${path}`, init)

/** A visitor's cookies after naming themselves (plus any unlock cookie passed in). */
async function visitor(token: string, name: string, cookie = ''): Promise<string> {
  const response = await gallery(token, '/visitor', { ...json({ name }), cookie })
  expect(response.status).toBe(201)
  return [cookie, cookiesFrom(response)].filter(Boolean).join('; ')
}

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  ids = []
  for (const name of ['a.jpg', 'b.jpg', 'c.jpg']) ids.push(await upload(name))
  await h.env.DB.prepare('UPDATE assets SET gps_lat = 60.39, gps_lng = 5.32, camera_model = ? WHERE id = ?').bind('Nikon Z 9', ids[0]).run()
  albumId = ((await (await h.fetch('/api/albums', { ...json({ name: 'Smith wedding' }), cookie: admin })).json()) as { album: { id: string } }).album.id
  // The first two are in the album; the third is not.
  await h.fetch(`/api/albums/${albumId}/items`, { ...json({ assetIds: [ids[0], ids[1]] }), cookie: admin })
})
afterEach(async () => h.dispose())

describe('making links', () => {
  it('needs shares:manage', async () => {
    await createUser(h, admin, { name: 'V', email: 'v@example.com', password: 'viewer password 1', roles: ['viewer'] })
    const viewer = cookiesFrom(await signIn(h, 'v@example.com', 'viewer password 1'))
    expect((await h.fetch('/api/shares', { ...json({ albumId, name: 'x' }), cookie: viewer })).status).toBe(403)
    expect((await h.fetch('/api/shares', { cookie: viewer })).status).toBe(403)
  })

  it('lists, edits and revokes; a revoked link stays revoked', async () => {
    const link = await share({ title: 'Your wedding', downloadSizes: ['small'] })
    expect(link.token).toMatch(/^[0-9A-Za-z]{22}$/)
    expect((await h.fetch('/api/shares', { ...json({ albumId, name: 'x', downloadSizes: ['bogus'] }), cookie: admin })).status).toBe(400)
    const listed = (await (await h.fetch(`/api/shares?albumId=${albumId}`, { cookie: admin })).json()) as { shares: Share[] }
    expect(listed.shares.map((s) => s.id)).toEqual([link.id])
    expect((await h.fetch(`/api/shares/${link.id}`, { method: 'PATCH', body: JSON.stringify({ password: 'swordfish' }), cookie: admin })).status).toBe(200)
    expect((await h.fetch(`/api/shares/${link.id}/revoke`, { method: 'POST', cookie: admin })).status).toBe(200)
    expect((await h.fetch(`/api/shares/${link.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'again' }), cookie: admin })).status).toBe(404)
    expect((await gallery(link.token)).status).toBe(404)
  })
})

describe('the gallery', () => {
  it('shows the album and nothing else, and counts the open', async () => {
    const link = await share()
    const response = await gallery(link.token)
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
    const body = (await response.json()) as { gallery: { title: string }; items: Record<string, unknown>[] }
    expect(body.gallery.title).toBe('Smith wedding')
    expect(body.items.map((i) => i.id)).toEqual([ids[0], ids[1]])
    // No camera, place or archive details reach a client.
    const text = JSON.stringify(body)
    for (const secret of ['Nikon', '60.39', 'gps', 'camera', 'storage', 'sha256']) expect(text).not.toContain(secret)

    expect((await gallery(link.token, `/assets/${ids[0]}/thumb`)).headers.get('Content-Type')).toBe('image/webp')
    expect((await gallery(link.token, `/assets/${ids[2]}/thumb`)).status).toBe(404)
    expect((await gallery(link.token, `/assets/${ids[0]}/sheet`)).status).toBe(404)
    const stats = (await (await h.fetch(`/api/shares/${link.id}`, { cookie: admin })).json()) as { share: Share }
    expect(stats.share.stats.opens).toBe(1)
  })

  it('treats unknown links like revoked ones, and says when one has expired', async () => {
    expect((await gallery('A'.repeat(22))).status).toBe(404)
    expect((await gallery('short')).status).toBe(404)
    const link = await share({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
    const expired = await gallery(link.token)
    expect(expired.status).toBe(410)
    expect(((await expired.json()) as { error: string }).error).toBe('expired')
    expect((await gallery(link.token, `/assets/${ids[0]}/thumb`)).status).toBe(410)
  })

  it('asks for the password, remembers it, and forgets it when it changes', async () => {
    const link = await share({ password: 'swordfish' })
    expect((await gallery(link.token)).status).toBe(401)
    expect((await gallery(link.token, `/assets/${ids[0]}/thumb`)).status).toBe(401)
    expect((await gallery(link.token, '/unlock', json({ password: 'herring' }))).status).toBe(401)
    const unlocked = await gallery(link.token, '/unlock', json({ password: 'swordfish' }))
    expect(unlocked.status).toBe(200)
    expect(unlocked.headers.get('Set-Cookie')).toContain('HttpOnly')
    const cookie = cookiesFrom(unlocked)
    expect((await gallery(link.token, '', { cookie })).status).toBe(200)
    // A forged or other gallery's cookie does nothing.
    expect((await gallery(link.token, '', { cookie: cookie.replace(/\.[0-9a-f]+$/, '.00') })).status).toBe(401)
    await h.fetch(`/api/shares/${link.id}`, { method: 'PATCH', body: JSON.stringify({ password: 'mackerel' }), cookie: admin })
    expect((await gallery(link.token, '', { cookie })).status).toBe(401)
  })

  it('limits password guesses', async () => {
    const link = await share({ password: 'swordfish' })
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await gallery(link.token, '/unlock', { ...json({ password: `guess ${i}` }), ip: '203.0.113.9' })).status)
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})

describe('favourites', () => {
  it('records picks per person, and the photographer compares them and makes an album', async () => {
    const link = await share()
    expect((await gallery(link.token, `/picks/${ids[0]}`, { method: 'PUT' })).status).toBe(409)
    const ann = await visitor(link.token, 'Ann')
    const bob = await visitor(link.token, 'Bob')
    for (const id of [ids[0], ids[1]]) expect((await gallery(link.token, `/picks/${id}`, { method: 'PUT', cookie: ann })).status).toBe(204)
    expect((await gallery(link.token, `/picks/${ids[1]}`, { method: 'PUT', cookie: bob })).status).toBe(204)
    // Not in the album: not pickable.
    expect((await gallery(link.token, `/picks/${ids[2]}`, { method: 'PUT', cookie: bob })).status).toBe(404)
    expect((await gallery(link.token, '/submit', { method: 'POST', cookie: ann })).status).toBe(200)

    const mine = (await (await gallery(link.token, '', { cookie: ann })).json()) as { picks: string[]; visitor: { name: string; submittedAt: string | null } }
    expect(mine.picks).toEqual([ids[0], ids[1]])
    expect(mine.visitor.submittedAt).not.toBeNull()
    // Changing a pick after "I'm done" reopens the selection.
    await gallery(link.token, `/picks/${ids[0]}`, { method: 'DELETE', cookie: ann })
    await gallery(link.token, `/picks/${ids[0]}`, { method: 'PUT', cookie: ann })

    const detail = (await (await h.fetch(`/api/shares/${link.id}`, { cookie: admin })).json()) as {
      visitors: { id: string; name: string; picks: number; submittedAt: string | null }[]
      picks: Record<string, string[]>
    }
    expect(detail.visitors.map((v) => [v.name, v.picks, v.submittedAt])).toEqual([
      ['Ann', 2, null],
      ['Bob', 1, null],
    ])
    expect(detail.picks[ids[1]!]).toHaveLength(2)

    const both = await h.fetch(`/api/shares/${link.id}/picks/album`, { ...json({ name: 'Both like', mode: 'all' }), cookie: admin })
    expect(both.status).toBe(201)
    const made = (await both.json()) as { albumId: string; count: number }
    expect(made.count).toBe(1)
    const items = (await (await h.fetch(`/api/assets?album=${made.albumId}`, { cookie: admin })).json()) as { assets: { id: string }[] }
    expect(items.assets.map((a) => a.id)).toEqual([ids[1]])
    const annOnly = (await (await h.fetch(`/api/shares/${link.id}/picks/album`, { ...json({ name: 'Ann', visitorIds: [detail.visitors[0]!.id] }), cookie: admin })).json()) as { count: number }
    expect(annOnly.count).toBe(2)
  })

  it('takes no favourites when the link says so', async () => {
    const link = await share({ proofing: false })
    expect((await gallery(link.token, '/visitor', json({ name: 'Ann' }))).status).toBe(403)
  })
})

describe('downloads', () => {
  it('offers only the sizes the link allows, and counts them', async () => {
    const link = await share({ downloadSizes: ['small', 'original'] })
    expect((await gallery(link.token, `/assets/${ids[0]}/download/large`)).status).toBe(403)
    expect((await gallery(link.token, `/assets/${ids[2]}/download/small`)).status).toBe(404)
    const small = await gallery(link.token, `/assets/${ids[0]}/download/small`)
    expect(small.status).toBe(200)
    expect(small.headers.get('Content-Type')).toBe('image/jpeg')
    expect(small.headers.get('Content-Disposition')).toContain('a-small.jpg')
    const original = await gallery(link.token, `/assets/${ids[0]}/download/original`)
    expect(original.status).toBe(200)
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(camera)
    const stats = (await (await h.fetch(`/api/shares/${link.id}`, { cookie: admin })).json()) as { share: Share; downloads: { size: string; count: number }[] }
    expect(stats.share.stats.downloads).toBe(2)
    expect(stats.downloads.map((d) => d.size).sort()).toEqual(['original', 'small'])
  })

  it('never sends an original that is in deep storage or on a NAS', async () => {
    const link = await share({ downloadSizes: ['original'] })
    await h.env.DB.prepare("UPDATE asset_locations SET storage_class = 'DEEP_ARCHIVE', state = 'archived' WHERE asset_id = ?").bind(ids[0]).run()
    expect((await gallery(link.token, `/assets/${ids[0]}/download/original`)).status).toBe(409)
    const listed = (await (await gallery(link.token)).json()) as { items: { id: string; originalReachable: boolean }[] }
    expect(listed.items.find((i) => i.id === ids[0])?.originalReachable).toBe(false)
    expect(listed.items.find((i) => i.id === ids[1])?.originalReachable).toBe(true)
  })
})

describe('watermarks', () => {
  it('watermarks what a watermarked link shows, keeps it, and prunes it when the watermark changes', async () => {
    const plainLink = await share()
    const marked = await share({ watermark: true, downloadSizes: ['large'] })
    // No watermark image yet: the plain preview.
    const plain = new Uint8Array(await (await gallery(plainLink.token, `/assets/${ids[0]}/preview`)).arrayBuffer())
    expect(new Uint8Array(await (await gallery(marked.token, `/assets/${ids[0]}/preview`)).arrayBuffer())).toEqual(plain)

    const set = await h.fetch('/api/shares/watermark/image', { method: 'PUT', body: gradient, headers: { 'Content-Type': 'image/png' }, cookie: admin })
    expect(set.status).toBe(200)
    const first = ((await set.json()) as { watermark: { version: string } }).watermark.version
    // The local Images emulator ignores draw() (checked 2026-10-19), so here the watermarked copy only
    // differs by being re-encoded; test/images.live.test.ts checks the pixels on real Images.
    const watermarked = new Uint8Array(await (await gallery(marked.token, `/assets/${ids[0]}/preview`)).arrayBuffer())
    expect(watermarked).not.toEqual(plain)
    expect(new Uint8Array(await (await gallery(plainLink.token, `/assets/${ids[0]}/preview`)).arrayBuffer())).toEqual(plain)
    expect((await gallery(marked.token, `/assets/${ids[0]}/download/large`)).headers.get('Content-Type')).toBe('image/jpeg')
    const cached = async () => (await h.env.MEDIA_BUCKET!.list({ prefix: 'gallery/' })).objects.map((o) => o.key)
    expect((await cached()).filter((k) => k.startsWith(`gallery/${first}/`))).toHaveLength(2)
    const json = (await (await gallery(marked.token)).json()) as { gallery: { imageVersion: string } }
    expect(json.gallery.imageVersion).toBe(first)

    const moved = (await (await h.fetch('/api/shares/watermark', { method: 'PATCH', body: JSON.stringify({ position: 'tiled' }), cookie: admin })).json()) as { watermark: { version: string } }
    expect(moved.watermark.version).not.toBe(first)
    for (let i = 0; i < 3; i++) await runSweep(h.env, SLICES)
    expect(await cached()).toEqual([])
    expect((await h.env.MEDIA_BUCKET!.list({ prefix: 'watermarks/' })).objects.map((o) => o.key)).toEqual([`watermarks/${moved.watermark.version}.png`])
  })

  it('refuses a file that is not an image', async () => {
    const response = await h.fetch('/api/shares/watermark/image', { method: 'PUT', body: new TextEncoder().encode('not an image'), headers: { 'Content-Type': 'image/png' }, cookie: admin })
    expect(response.status).toBe(400)
  })
})
