import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cookiesFrom, createHarness, createUser, json, setUpAdmin, signIn, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

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

async function share(body: Record<string, unknown> = {}): Promise<{ id: string; token: string }> {
  const response = await h.fetch('/api/shares', { ...json({ albumId, name: 'For the Smiths', ...body }), cookie: admin })
  expect(response.status).toBe(201)
  return ((await response.json()) as { share: { id: string; token: string } }).share
}

interface Invited {
  member: { userId: string; joined: boolean; email: string }
  invite: { token: string; expiresAt: string } | null
}

async function invite(shareId: string, email = 'jane@example.com', name = 'Jane Smith'): Promise<Invited> {
  const response = await h.fetch(`/api/shares/${shareId}/members`, { ...json({ name, email }), cookie: admin })
  expect(response.status).toBe(201)
  return (await response.json()) as Invited
}

/** Use the invite and sign in, as the invite page does. Returns the client's cookie. */
async function join(token: string, email = 'jane@example.com', password = 'a long client password'): Promise<string> {
  expect((await h.fetch(`/api/invites/${token}`, json({ password }))).status).toBe(200)
  const response = await signIn(h, email, password)
  expect(response.status).toBe(200)
  return cookiesFrom(response)
}

const PASSWORD = 'for the smiths'

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  ids = [await upload('a.jpg'), await upload('b.jpg'), await upload('c.jpg')]
  albumId = ((await (await h.fetch('/api/albums', { ...json({ name: 'Smith wedding' }), cookie: admin })).json()) as { album: { id: string } }).album.id
  await h.fetch(`/api/albums/${albumId}/items`, { ...json({ assetIds: [ids[0], ids[1]] }), cookie: admin })
})
afterEach(async () => h.dispose())

describe('client accounts', () => {
  it('invites, joins once, and sees only their galleries, without the link password', async () => {
    const link = await share({ password: PASSWORD })
    const { member, invite: inv } = await invite(link.id)
    expect(member).toMatchObject({ joined: false, email: 'jane@example.com' })
    expect(inv?.token).toMatch(/^[0-9A-Za-z]{32}$/)

    // The invite says who it's for; a short password is refused and leaves the invite usable.
    expect(await (await h.fetch(`/api/invites/${inv!.token}`)).json()).toEqual({ name: 'Jane Smith', email: 'jane@example.com' })
    expect((await h.fetch(`/api/invites/${inv!.token}`, json({ password: 'short' }))).status).toBe(400)
    const client = await join(inv!.token)
    // Spent.
    expect((await h.fetch(`/api/invites/${inv!.token}`)).status).toBe(404)
    expect((await h.fetch(`/api/invites/${inv!.token}`, json({ password: 'another long password' }))).status).toBe(404)

    // Nothing of the archive.
    for (const path of ['/api/assets', '/api/albums', '/api/shares', '/api/users', `/api/assets/${ids[0]}/renditions/thumb`]) {
      expect((await h.fetch(path, { cookie: client })).status, path).toBe(403)
    }
    const me = (await (await h.fetch('/api/me', { cookie: client })).json()) as { roles: string[]; permissions: string[] }
    expect(me).toMatchObject({ roles: ['client'], permissions: [] })

    // Their galleries.
    const mine = (await (await h.fetch('/api/me/galleries', { cookie: client })).json()) as { galleries: { token: string; photos: number; coverId: string; expired: boolean }[] }
    expect(mine.galleries).toEqual([expect.objectContaining({ token: link.token, photos: 2, coverId: ids[0], expired: false })])

    // Signed in, no password; signed out, the password as before.
    expect((await h.fetch(`/api/public/galleries/${link.token}`)).status).toBe(401)
    const open = await h.fetch(`/api/public/galleries/${link.token}`, { cookie: client })
    expect(open.status).toBe(200)
    const body = (await open.json()) as { member: { name: string }; visitor: { name: string } }
    expect(body).toMatchObject({ member: { name: 'Jane Smith' }, visitor: { name: 'Jane Smith' } })
    expect((await h.fetch(`/api/public/galleries/${link.token}/assets/${ids[0]}/thumb`, { cookie: client })).status).toBe(200)
    expect((await h.fetch(`/api/public/galleries/${link.token}/assets/${ids[2]}/thumb`, { cookie: client })).status).toBe(404)

    // Favourites are theirs, from any browser: a second sign-in sees the first one's pick.
    expect((await h.fetch(`/api/public/galleries/${link.token}/picks/${ids[1]}`, { method: 'PUT', cookie: client })).status).toBe(204)
    const elsewhere = cookiesFrom(await signIn(h, 'jane@example.com', 'a long client password'))
    expect(((await (await h.fetch(`/api/public/galleries/${link.token}`, { cookie: elsewhere })).json()) as { picks: string[] }).picks).toEqual([ids[1]])
    const stats = (await (await h.fetch(`/api/shares/${link.id}`, { cookie: admin })).json()) as { visitors: { name: string; picks: number }[] }
    expect(stats.visitors).toEqual([expect.objectContaining({ name: 'Jane Smith', picks: 1 })])
  })

  it('keeps clients to their own links, and taking them off closes the door', async () => {
    const theirs = await share()
    const other = await share({ name: 'For the Joneses', password: PASSWORD })
    const client = await join((await invite(theirs.id)).invite!.token)
    expect((await h.fetch(`/api/public/galleries/${other.token}`, { cookie: client })).status).toBe(401)

    // Invited to a second link later: already joined, so no new invite, and both are listed.
    const again = await invite(other.id)
    expect(again).toMatchObject({ member: { joined: true }, invite: null })
    expect(((await (await h.fetch('/api/me/galleries', { cookie: client })).json()) as { galleries: unknown[] }).galleries).toHaveLength(2)
    expect((await h.fetch(`/api/public/galleries/${other.token}`, { cookie: client })).status).toBe(200)

    expect((await h.fetch(`/api/shares/${other.id}/members/${again.member.userId}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    expect((await h.fetch(`/api/public/galleries/${other.token}`, { cookie: client })).status).toBe(401)
    // A revoked link drops off their list.
    await h.fetch(`/api/shares/${theirs.id}/revoke`, { method: 'POST', cookie: admin })
    expect(((await (await h.fetch('/api/me/galleries', { cookie: client })).json()) as { galleries: unknown[] }).galleries).toEqual([])
  })

  it('makes a new invite replace the old one, and refuses to make a team member a client', async () => {
    const link = await share()
    const first = await invite(link.id)
    const renewed = (await (await h.fetch(`/api/shares/${link.id}/members/${first.member.userId}/invite`, { method: 'POST', cookie: admin })).json()) as { invite: { token: string } }
    expect((await h.fetch(`/api/invites/${first.invite!.token}`)).status).toBe(404)
    await join(renewed.invite.token)
    expect((await h.fetch(`/api/shares/${link.id}/members/${first.member.userId}/invite`, { method: 'POST', cookie: admin })).status).toBe(409)

    await createUser(h, admin, { name: 'Ed', email: 'ed@example.com', password: 'editor password 1', roles: ['editor'] })
    expect((await h.fetch(`/api/shares/${link.id}/members`, { ...json({ name: 'Ed', email: 'ED@example.com' }), cookie: admin })).status).toBe(409)
    // Inviting needs shares:manage.
    const viewer = await createUser(h, admin, { name: 'V', email: 'v@example.com', password: 'viewer password 1', roles: ['viewer'] })
    void viewer
    const viewerCookie = cookiesFrom(await signIn(h, 'v@example.com', 'viewer password 1'))
    expect((await h.fetch(`/api/shares/${link.id}/members`, { ...json({ name: 'X', email: 'x@example.com' }), cookie: viewerCookie })).status).toBe(403)
  })

  it("isn't asked for two-step sign-in when the team is", async () => {
    const link = await share()
    const client = await join((await invite(link.id)).invite!.token)
    await h.env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('auth.require_2fa', 'everyone', '2026-01-01')").run()
    expect(((await (await h.fetch('/api/me', { cookie: client })).json()) as { setup: string | null }).setup).toBeNull()
  })

  it('leaves favourites in the stats when a client account is deleted', async () => {
    const link = await share()
    const { member, invite: inv } = await invite(link.id)
    const client = await join(inv!.token)
    await h.fetch(`/api/public/galleries/${link.token}/picks/${ids[0]}`, { method: 'PUT', cookie: client })
    expect((await h.fetch(`/api/users/${member.userId}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    const stats = (await (await h.fetch(`/api/shares/${link.id}`, { cookie: admin })).json()) as { visitors: { name: string; picks: number }[] }
    expect(stats.visitors).toEqual([expect.objectContaining({ name: 'Jane Smith', picks: 1 })])
    expect((await h.fetch(`/api/shares/${link.id}/members`, { cookie: admin }).then((r) => r.json())) as { members: unknown[] }).toEqual({ members: [] })
  })
})
