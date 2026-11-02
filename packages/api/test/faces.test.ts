import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseBoxes, removeSlice } from '../src/catalog/faces'
import { createHarness, createUser, json, setUpAdmin, signIn, cookiesFrom, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

let h: Harness
let admin: string
beforeEach(async () => {
  h = await createHarness({ FACES: '1' })
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

const MODEL = 'blazeface-fr-1/g23/t60'
const put = (path: string, body: unknown, cookie = admin) => h.fetch(path, { method: 'PUT', body: JSON.stringify(body), cookie })
const post = (path: string, body: unknown, cookie = admin) => h.fetch(path, { ...json(body), cookie })

async function upload(filename: string): Promise<string> {
  const created = (await (await post('/api/uploads', { filename, size: camera.byteLength, allowDuplicate: true })).json()) as { uploadId: string }
  const part = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await post(`/api/uploads/${created.uploadId}/complete`, { parts: [{ partNumber: 1, etag: part.headers.get('ETag') }] })
  return ((await done.json()) as { assetId: string }).assetId
}

async function album(ids: string[]): Promise<string> {
  const { album } = (await (await post('/api/albums', { name: 'Wedding' })).json()) as { album: { id: string } }
  await post('/api/assets/bulk', { ids, action: 'album-add', albumId: album.id })
  return album.id
}

const turnOn = () => put('/api/faces/settings', { on: true, understood: true })
const status = async () => (await (await h.fetch('/api/faces/status', { cookie: admin })).json()) as { on: boolean; epoch: number; removing: boolean; counts: { boxes: number; named: number; toLook: number } }
const queue = async (albumId: string) => (await (await h.fetch(`/api/faces/queue?album=${albumId}`, { cookie: admin })).json()) as { epoch: number; photos: { assetId: string; frame: string | null }[] }
const frameOf = async (id: string) => (await h.env.DB.prepare('SELECT faces_frame FROM assets WHERE id = ?').bind(id).first<{ faces_frame: string }>())!.faces_frame
const facesOf = async (id: string) => ((await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as { faces?: { id: number; x: number; personId: number | null; name: string | null; setAside: boolean }[] }).faces
const tags = async (id: string) =>
  (await h.env.DB.prepare('SELECT p.name, ap.how FROM asset_people ap JOIN people p ON p.id = ap.person_id WHERE ap.asset_id = ? ORDER BY p.name').bind(id).all<{ name: string; how: string }>()).results
const ANNA = { x: 100, y: 120, w: 80, h: 100, score: 910 }
const BEN = { x: 500, y: 140, w: 70, h: 90, score: 870 }

async function sendBoxes(assetId: string, faces: unknown[], epoch: number, frame?: string) {
  return put('/api/faces/boxes', { model: MODEL, epoch, photos: [{ assetId, frame: frame ?? (await frameOf(assetId)), faces }] })
}

describe('faces left out at deploy', () => {
  it('has no routes and nothing on the photo', async () => {
    const off = await createHarness()
    const cookie = await setUpAdmin(off)
    expect((await off.fetch('/api/faces/status', { cookie })).status).toBe(404)
    expect((await off.fetch('/api/agent/faces', json({}))).status).not.toBe(200)
    const created = (await (await off.fetch('/api/uploads', { ...json({ filename: 'a.jpg', size: camera.byteLength, allowDuplicate: true }), cookie })).json()) as { uploadId: string }
    const part = await off.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie })
    const done = (await (await off.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: part.headers.get('ETag') }] }), cookie })).json()) as { assetId: string }
    expect(Object.keys(await (await off.fetch(`/api/assets/${done.assetId}`, { cookie })).json())).not.toContain('faces')
    await off.dispose()
  })
})

describe('the switch', () => {
  it('turns on only with the tick, needs settings:manage, and changes the epoch each time', async () => {
    const first = await status()
    expect(first.on).toBe(false)
    expect((await put('/api/faces/settings', { on: true })).status).toBe(400)
    await createUser(h, admin, { name: 'Ed Editor', email: 'ed@example.com', password: 'correct horse battery staple', roles: ['editor'] })
    const ed = cookiesFrom(await signIn(h, 'ed@example.com', 'correct horse battery staple'))
    expect((await put('/api/faces/settings', { on: true, understood: true }, ed)).status).toBe(403)
    expect((await turnOn()).status).toBe(200)
    const on = await status()
    expect(on.on).toBe(true)
    expect(on.epoch).toBe(first.epoch + 1)
    const activity = await h.env.DB.prepare("SELECT action FROM activity_log WHERE action LIKE 'faces.%'").all<{ action: string }>()
    expect(activity.results.map((r) => r.action)).toEqual(['faces.turned_on'])
  })
})

describe('looking for faces in a browser tab', () => {
  it('hands out an album’s photos once, stores what was found, and shows it on the photo page', async () => {
    const [a, b] = [await upload('a.jpg'), await upload('b.jpg')]
    const albumId = await album([a, b])
    expect((await h.fetch(`/api/faces/queue?album=${albumId}`, { cookie: admin })).status).toBe(409)
    await turnOn()
    const first = await queue(albumId)
    expect(first.photos.map((p) => p.assetId).sort()).toEqual([a, b].sort())
    expect((await queue(albumId)).photos).toEqual([]) // claimed for ten minutes
    expect((await sendBoxes(a, [ANNA, BEN], first.epoch)).status).toBe(200)
    const faces = await facesOf(a)
    expect(faces?.map((f) => f.x)).toEqual([100, 500])
    expect((await h.env.DB.prepare('SELECT faces_state FROM assets WHERE id = ?').bind(a).first<{ faces_state: string }>())?.faces_state).toBe('done')
  })

  it('counts an album’s photos for the panel, and a peek claims nothing', async () => {
    const [a, b] = [await upload('a.jpg'), await upload('b.jpg')]
    const albumId = await album([a, b])
    await turnOn()
    const peek = (await (await h.fetch(`/api/faces/queue?album=${albumId}&peek=1`, { cookie: admin })).json()) as { photos: unknown[]; counts: Record<string, number> }
    expect(peek.photos).toEqual([])
    expect(peek.counts).toEqual({ toLook: 2, done: 0, failed: 0, without: 0 })
    const { epoch } = await queue(albumId)
    await sendBoxes(a, [ANNA], epoch)
    const after = (await (await h.fetch(`/api/faces/queue?album=${albumId}&peek=1`, { cookie: admin })).json()) as { counts: Record<string, number> }
    expect(after.counts).toMatchObject({ toLook: 1, done: 1 })
  })

  it('refuses boxes for an old preview, from another epoch, while paused, and anything but boxes', async () => {
    const a = await upload('a.jpg')
    const albumId = await album([a])
    await turnOn()
    const { epoch } = await queue(albumId)
    const stale = (await (await sendBoxes(a, [ANNA], epoch, '2048x1365:1')).json()) as { results: { status: string }[] }
    expect(stale.results[0]!.status).toBe('stale')
    expect((await sendBoxes(a, [ANNA], epoch - 1)).status).toBe(409)
    expect((await sendBoxes(a, [{ ...ANNA, keypoints: [1, 2] }], epoch)).status).toBe(400)
    expect((await sendBoxes(a, [{ ...ANNA, x: 950 }], epoch)).status).toBe(400)
    await put('/api/faces/settings', { on: false })
    expect((await sendBoxes(a, [ANNA], epoch)).status).toBe(409)
    expect(await facesOf(a)).toEqual([])
    expect(() => parseBoxes([{ x: 1.5, y: 0, w: 1, h: 1, score: 1 }])).toThrow()
  })

  it('marks a photo that can’t be read as failed after three tries, so it stops coming back', async () => {
    const a = await upload('a.jpg')
    const albumId = await album([a])
    await turnOn()
    for (let i = 0; i < 3; i++) {
      const { epoch } = await queue(albumId)
      await h.env.DB.prepare('UPDATE assets SET faces_claimed_at = NULL WHERE id = ?').bind(a).run()
      await put('/api/faces/boxes', { model: MODEL, epoch, photos: [{ assetId: a, failed: true }] })
    }
    expect((await h.env.DB.prepare('SELECT faces_state FROM assets WHERE id = ?').bind(a).first<{ faces_state: string }>())?.faces_state).toBe('failed')
    expect((await queue(albumId)).photos).toEqual([])
  })
})

describe('naming faces', () => {
  async function found() {
    const a = await upload('a.jpg')
    const albumId = await album([a])
    await turnOn()
    const { epoch } = await queue(albumId)
    await sendBoxes(a, [ANNA, BEN], epoch)
    const faces = (await facesOf(a))!
    return { a, albumId, epoch, anna: faces[0]!.id, ben: faces[1]!.id }
  }

  it('tags the photo, keeps an older tag as it was, and takes a face’s tag away with its last face', async () => {
    const { a, anna, ben } = await found()
    await post('/api/assets/bulk', { ids: [a], action: 'person', name: 'Ben Brook' })
    await post('/api/faces/choose', { faceIds: [anna], name: 'Anna Hansen' })
    await post('/api/faces/choose', { faceIds: [ben], name: 'Ben Brook' })
    expect(await tags(a)).toEqual([{ name: 'Anna Hansen', how: 'face' }, { name: 'Ben Brook', how: 'hand' }])
    expect((await facesOf(a))!.map((f) => f.name)).toEqual(['Anna Hansen', 'Ben Brook'])
    await post('/api/faces/choose', { faceIds: [anna], clear: true })
    expect(await tags(a)).toEqual([{ name: 'Ben Brook', how: 'hand' }])
    await post('/api/faces/choose', { faceIds: [anna], setAside: true })
    expect((await facesOf(a))![0]).toMatchObject({ setAside: true, personId: null })
    expect((await post('/api/faces/choose', { faceIds: [ben], personId: 999999 })).status).toBe(400)
  })

  it('works while paused, and taking someone off the photo takes the name off their face', async () => {
    const { a, anna } = await found()
    await put('/api/faces/settings', { on: false })
    await post('/api/faces/choose', { faceIds: [anna], name: 'Anna Hansen' })
    const annaId = (await facesOf(a))![0]!.personId!
    await post('/api/assets/bulk', { ids: [a], action: 'person', personId: annaId, add: false })
    expect((await facesOf(a))![0]!.personId).toBeNull()
    expect(await tags(a)).toEqual([])
  })

  it('keeps names through looking again when the picture is the same, and drops the boxes (not the tags) when it changed shape', async () => {
    const { a, albumId, anna } = await found()
    await post('/api/faces/choose', { faceIds: [anna], name: 'Anna Hansen' })
    // Looked at again (a model change): the boxes move a little.
    await h.env.DB.prepare('UPDATE assets SET faces_state = NULL, faces_claimed_at = NULL WHERE id = ?').bind(a).run()
    const again = await queue(albumId)
    await sendBoxes(a, [{ ...ANNA, x: 104 }, BEN], again.epoch)
    expect((await facesOf(a))!.map((f) => [f.x, f.name])).toEqual([[104, 'Anna Hansen'], [500, null]])
    // A new, re-cropped preview: looked at again, and the old boxes don't fit it.
    await h.env.DB.prepare("UPDATE assets SET faces_frame = '1600x1600:1234', faces_state = NULL, faces_claimed_at = NULL WHERE id = ?").bind(a).run()
    expect(await facesOf(a)).toEqual([])
    const third = await queue(albumId)
    await sendBoxes(a, [ANNA], third.epoch, '1600x1600:1234')
    expect((await facesOf(a))!.map((f) => f.name)).toEqual([null])
    expect(await tags(a)).toEqual([{ name: 'Anna Hansen', how: 'hand' }])
  })
})

describe('people and faces', () => {
  it('merging moves faces; deleting a person sets their faces aside', async () => {
    const a = await upload('a.jpg')
    const albumId = await album([a])
    await turnOn()
    const { epoch } = await queue(albumId)
    await sendBoxes(a, [ANNA, BEN], epoch)
    const [anna, ben] = (await facesOf(a))!
    await post('/api/faces/choose', { faceIds: [anna!.id], name: 'Anna H' })
    await post('/api/faces/choose', { faceIds: [ben!.id], name: 'Anna Hansen' })
    const [from, into] = (await facesOf(a))!.map((f) => f.personId!)
    await post(`/api/people/${from}/merge`, { into })
    expect((await facesOf(a))!.map((f) => f.personId)).toEqual([into, into])
    await h.fetch(`/api/people/${into}`, { method: 'DELETE', cookie: admin })
    expect((await facesOf(a))!.map((f) => [f.personId, f.setAside])).toEqual([[null, true], [null, true]])
  })
})

describe('Remove all', () => {
  it('waits for a pause, then the sweep removes the boxes, keeps the names as tags and looks again next time', async () => {
    const a = await upload('a.jpg')
    const albumId = await album([a])
    await turnOn()
    const { epoch } = await queue(albumId)
    await sendBoxes(a, [ANNA, BEN], epoch)
    await post('/api/faces/choose', { faceIds: [(await facesOf(a))![0]!.id], name: 'Anna Hansen' })
    expect((await post('/api/faces/remove', {})).status).toBe(409)
    await put('/api/faces/settings', { on: false })
    const removed = (await (await post('/api/faces/remove', {})).json()) as { counts: { boxes: number; named: number } }
    expect(removed.counts).toMatchObject({ boxes: 2, named: 1 })
    expect((await status()).removing).toBe(true)
    expect(await removeSlice(h.env.DB)).toBe(2)
    expect(await removeSlice(h.env.DB)).toBe(0)
    expect(await removeSlice(h.env.DB)).toBeNull()
    expect(await facesOf(a)).toEqual([])
    expect(await tags(a)).toEqual([{ name: 'Anna Hansen', how: 'hand' }])
    expect((await h.env.DB.prepare('SELECT faces_state FROM assets WHERE id = ?').bind(a).first<{ faces_state: string | null }>())?.faces_state).toBeNull()
  })
})

describe('never to clients', () => {
  it('leaves faces out of the gallery a client sees', async () => {
    const a = await upload('a.jpg')
    const albumId = await album([a])
    await turnOn()
    const { epoch } = await queue(albumId)
    await sendBoxes(a, [ANNA], epoch)
    const share = (await (await post('/api/shares', { albumId, name: 'For the couple' })).json()) as { share: { token: string } }
    const res = await h.fetch(`/api/public/galleries/${share.share.token}`)
    expect(res.status).toBe(200)
    expect(await res.text()).not.toMatch(/faces|"frame"|"score"/)
  })
})

describe('the helper', () => {
  const agentFetch = (key: string, path: string, init: RequestInit = {}) =>
    h.fetch(path, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${key}` } })

  async function pair(name: string): Promise<{ key: string; sourceId: string }> {
    const { deviceCode, userCode } = (await (await h.fetch('/api/agent/pair/start', json({ name, platform: 'linux/amd64', version: '1.0.0' }))).json()) as { deviceCode: string; userCode: string }
    await h.fetch('/api/agent/pair/poll', json({ deviceCode }))
    await post('/api/sources/pair', { code: userCode })
    const done = (await (await h.fetch('/api/agent/pair/poll', json({ deviceCode }))).json()) as { apiKey: string; sourceId: string }
    await agentFetch(done.apiKey, '/api/agent/folders', json({ folders: ['/photos'] }))
    return { key: done.apiKey, sourceId: done.sourceId }
  }

  /** A helper's photo, with its preview sent: returns the photo and the frame cf-dam gave back. */
  async function photo(key: string, sourceId: string, path: string): Promise<{ id: string; frame: string }> {
    const root = ((await (await post(`/api/sources/${sourceId}/roots`, { path: '/photos/photo', label: 'Photo' })).json()) as { root?: { id: string } }).root?.id
    const roots = (await (await agentFetch(key, '/api/agent/config')).json()) as { roots: { id: string }[] }
    const { results } = (await (await agentFetch(key, '/api/agent/assets/batch', json({ items: [{ root: root ?? roots.roots[0]!.id, path, size: 1000, quickHash: path.padEnd(64, '0').replace(/[^0-9a-f]/g, 'a').slice(0, 64) }] }))).json()) as { results: { assetId: string }[] }
    const id = results[0]!.assetId
    const sharp = (await import('sharp')).default
    const preview = new Uint8Array(await sharp({ create: { width: 2048, height: 1365, channels: 3, background: '#468' } }).webp({ effort: 2 }).toBuffer())
    const thumb = new Uint8Array(await sharp({ create: { width: 480, height: 320, channels: 3, background: '#468' } }).webp({ effort: 2 }).toBuffer())
    await agentFetch(key, `/api/agent/assets/${id}/renditions/thumb`, { method: 'PUT', body: thumb })
    const sent = (await (await agentFetch(key, `/api/agent/assets/${id}/renditions/preview`, { method: 'PUT', body: preview })).json()) as { frame: string }
    await agentFetch(key, '/api/agent/assets/complete', json({ items: [{ id }] }))
    return { id, frame: sent.frame }
  }

  it('hears that faces are on, is handed its own photos to look at, and may only send boxes for them', async () => {
    const nas = await pair('Studio NAS')
    const { id, frame } = await photo(nas.key, nas.sourceId, 'a.jpg')
    expect(frame).toMatch(/^2048x1365:\d+$/)
    const beat = async (key: string, faces?: string) => (await (await agentFetch(key, '/api/agent/heartbeat', json({ status: '{}', ...(faces ? { faces } : {}) }))).json()) as { faces?: { model: string; epoch: number } | null; findFaces?: { assetId: string }[] }
    expect((await beat(nas.key, MODEL)).faces).toBeNull()
    await turnOn()
    expect((await beat(nas.key)).faces).toBeNull() // an older helper, without our model
    const on = await beat(nas.key, MODEL)
    expect(on.faces?.model).toBe(MODEL)
    expect(on.findFaces?.map((p) => p.assetId)).toEqual([id])

    const other = await pair('Laptop')
    const theirs = await agentFetch(other.key, '/api/agent/faces', json({ model: MODEL, epoch: on.faces!.epoch, photos: [{ assetId: id, frame, faces: [ANNA] }] }))
    expect(((await theirs.json()) as { results: { status: string }[] }).results[0]!.status).toBe('gone')
    const mine = await agentFetch(nas.key, '/api/agent/faces', json({ model: MODEL, epoch: on.faces!.epoch, photos: [{ assetId: id, frame, faces: [ANNA] }] }))
    expect(((await mine.json()) as { results: { status: string }[] }).results[0]!.status).toBe('stored')
    expect((await facesOf(id))!.map((f) => f.x)).toEqual([100])

    // Paused: the heartbeat says so at once, and what it sends is refused.
    await put('/api/faces/settings', { on: false })
    expect((await beat(nas.key, MODEL)).faces).toBeNull()
    expect((await agentFetch(nas.key, '/api/agent/faces', json({ model: MODEL, epoch: on.faces!.epoch, photos: [{ assetId: id, frame, faces: [BEN] }] }))).status).toBe(409)
  })
})

describe('faces to name', () => {
  it('lists an album’s unnamed faces largest first, leaves out named and set-aside ones, and names several at once', async () => {
    const [a, b] = [await upload('a.jpg'), await upload('b.jpg')]
    const albumId = await album([a, b])
    await turnOn()
    const { epoch } = await queue(albumId)
    await sendBoxes(a, [ANNA, BEN], epoch)
    await sendBoxes(b, [{ x: 300, y: 300, w: 200, h: 220, score: 900 }, { x: 10, y: 10, w: 20, h: 25, score: 700 }], epoch)
    const list = async () => (await (await h.fetch(`/api/faces/unnamed?album=${albumId}`, { cookie: admin })).json()) as { faces: { id: number; w: number }[]; total: number; next: unknown }
    const first = await list()
    expect(first.total).toBe(4)
    expect(first.faces.map((f) => f.w)).toEqual([200, 80, 70, 20])
    expect(first.next).toBeNull()
    await post('/api/faces/choose', { faceIds: [first.faces[0]!.id, first.faces[1]!.id], name: 'Anna Hansen' })
    await post('/api/faces/choose', { faceIds: [first.faces[3]!.id], setAside: true })
    const after = await list()
    expect(after.faces.map((f) => f.w)).toEqual([70])
    expect(await tags(a)).toEqual([{ name: 'Anna Hansen', how: 'face' }])
    expect(await tags(b)).toEqual([{ name: 'Anna Hansen', how: 'face' }])
  })
})
