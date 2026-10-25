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
    expect((await h.fetch(`/api/shares/${link.id}/members`, { cookie: admin }).then((r) => r.json())) as { members: unknown[] }).toMatchObject({ members: [] })
  })
})

describe('clients (the Clients section)', () => {
  interface ClientPage {
    client: { id: string; name: string; people: number; openGalleries: number; pastAt: string | null; lastSeenAt: string | null }
    people: { userId: string; email: string; joined: boolean; galleries: number }[]
    galleries: { id: string; name: string }[]
    downloads: { shareName: string; person: string; filename: string | null; size: string | null }[]
  }
  const create = async (body: Record<string, unknown>) => {
    const response = await h.fetch('/api/clients', { ...json(body), cookie: admin })
    expect(response.status).toBe(201)
    return ((await response.json()) as ClientPage).client
  }
  const page = async (id: string) => (await (await h.fetch(`/api/clients/${id}`, { cookie: admin })).json()) as ClientPage
  const search = async (q: string, past = false) =>
    ((await (await h.fetch(`/api/clients?q=${encodeURIComponent(q)}${past ? '&past=1' : ''}`, { cookie: admin })).json()) as { clients: { name: string }[] }).clients.map((c) => c.name)

  it('is for administrators only', async () => {
    const editor = await createUser(h, admin, { name: 'Eddie Editor', email: 'eddie@example.com', password: 'an editor password', roles: ['editor'] })
    expect(editor).toBeTruthy()
    const cookie = cookiesFrom(await signIn(h, 'eddie@example.com', 'an editor password'))
    expect((await h.fetch('/api/clients', { cookie })).status).toBe(403)
    expect((await h.fetch('/api/clients', { ...json({ name: 'Hansen' }), cookie })).status).toBe(403)
  })

  it('searches without minding accents, hides past clients, and needs a name', async () => {
    expect((await h.fetch('/api/clients', { ...json({ name: '  ' }), cookie: admin })).status).toBe(400)
    expect((await h.fetch('/api/clients', { ...json({ name: 'X', email: 'not an email' }), cookie: admin })).status).toBe(400)
    const muller = await create({ name: 'Jürgen Müller', company: 'Brücke GmbH', email: 'JM@Bruecke.example' })
    await create({ name: 'Anna Hansen', phone: '+45 1234' })
    expect(await search('muller')).toEqual(['Jürgen Müller'])
    expect(await search('brucke jurgen')).toEqual(['Jürgen Müller'])
    expect(await search('jm@bruecke')).toEqual(['Jürgen Müller'])
    expect(await search('1234')).toEqual(['Anna Hansen'])
    expect(await search('')).toEqual(['Anna Hansen', 'Jürgen Müller'])
    expect(await search('100%')).toEqual([])

    expect((await h.fetch(`/api/clients/${muller.id}/past`, { ...json({ past: true }), cookie: admin })).status).toBe(200)
    expect(await search('')).toEqual(['Anna Hansen'])
    expect(await search('', true)).toEqual(['Jürgen Müller'])
    const changed = await h.fetch(`/api/clients/${muller.id}`, { method: 'PATCH', body: JSON.stringify({ notes: 'Prefers matte prints', language: 'de', crmUrl: 'https://my.studioninja.co/clients/42' }), cookie: admin })
    expect(await changed.json()).toMatchObject({ client: { notes: 'Prefers matte prints', language: 'de', crmUrl: 'https://my.studioninja.co/clients/42', pastAt: expect.any(String) } })
    expect((await h.fetch(`/api/clients/${muller.id}`, { method: 'PATCH', body: JSON.stringify({ crmUrl: 'javascript:alert(1)' }), cookie: admin })).status).toBe(400)
  })

  it('links logins to one client, finds them by their people, and shows their galleries and downloads', async () => {
    const hansen = await create({ name: 'The Hansens', email: 'anna@example.com' })
    const other = await create({ name: 'Someone else' })
    const link = await share()
    const { member, invite: inv } = await invite(link.id, 'anna@example.com', 'Anna Hansen')

    // An unlinked login with the client's email is offered first.
    const { candidates } = (await (await h.fetch(`/api/clients/${hansen.id}/candidates`, { cookie: admin })).json()) as { candidates: { userId: string; suggested: boolean }[] }
    expect(candidates[0]).toMatchObject({ userId: member.userId, suggested: true })

    expect((await h.fetch(`/api/clients/${hansen.id}/people`, { ...json({ userId: member.userId }), cookie: admin })).status).toBe(201)
    // One client per login; the team can't be linked.
    const elsewhere = await h.fetch(`/api/clients/${other.id}/people`, { ...json({ userId: member.userId }), cookie: admin })
    expect(elsewhere.status).toBe(409)
    expect(((await elsewhere.json()) as { message: string }).message).toContain('The Hansens')
    const adminId = ((await (await h.fetch('/api/me', { cookie: admin })).json()) as { id: string }).id
    expect((await h.fetch(`/api/clients/${other.id}/people`, { ...json({ userId: adminId }), cookie: admin })).status).toBe(409)

    // A new person made from the client's page gets an invite; asking again gives a new one.
    const added = await h.fetch(`/api/clients/${hansen.id}/people`, { ...json({ name: 'Tom Hansen', email: 'tom@example.com' }), cookie: admin })
    expect(added.status).toBe(201)
    const first = ((await added.json()) as { invite: { token: string } }).invite.token
    const again = ((await (await h.fetch(`/api/clients/${hansen.id}/people`, { ...json({ name: 'Tom Hansen', email: 'tom@example.com' }), cookie: admin })).json()) as { invite: { token: string } }).invite.token
    expect(again).not.toBe(first)
    expect(await search('tom@example')).toEqual(['The Hansens'])

    // Anna joins, opens the gallery and downloads; it all shows on the client's page.
    const client = await join(inv!.token, 'anna@example.com')
    expect((await h.fetch(`/api/public/galleries/${link.token}`, { cookie: client })).status).toBe(200)
    const visitor = await h.env.DB.prepare('SELECT id FROM share_visitors WHERE user_id = ?').bind(member.userId).first<{ id: string }>()
    await h.env.DB.prepare("INSERT INTO share_events (share_id, visitor_id, kind, asset_id, size, created_at) VALUES (?, ?, 'download', ?, 'large', ?)").bind(link.id, visitor!.id, ids[0], new Date().toISOString()).run()
    const shown = await page(hansen.id)
    expect(shown.client).toMatchObject({ people: 2, openGalleries: 1, lastSeenAt: expect.any(String) })
    expect(shown.people.map((p) => [p.email, p.joined, p.galleries])).toEqual([['anna@example.com', true, 1], ['tom@example.com', false, 0]])
    expect(shown.galleries.map((g) => g.id)).toEqual([link.id])
    expect(shown.downloads).toEqual([expect.objectContaining({ shareName: 'For the Smiths', person: 'Anna Hansen', filename: 'a.jpg', size: 'large' })])

    // Their history: what was done to the client and to their people.
    const history = (await (await h.fetch(`/api/activity?client=${hansen.id}`, { cookie: admin })).json()) as { entries: { action: string }[] }
    expect(history.entries.map((e) => e.action)).toEqual(expect.arrayContaining(['client.created', 'client.linked', 'client.invited', 'client.joined']))

    // Unlinking keeps the login and its gallery.
    expect((await h.fetch(`/api/clients/${hansen.id}/people/${member.userId}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    expect((await h.fetch(`/api/public/galleries/${link.token}`, { cookie: client })).status).toBe(200)
    expect((await page(hansen.id)).galleries).toEqual([])
  })

  it('erases a client: their logins, the names they gave, and their history details, but not the galleries', async () => {
    const hansen = await create({ name: 'The Hansens', email: 'anna@example.com', notes: 'Private notes' })
    const link = await share()
    const { member, invite: inv } = await invite(link.id, 'anna@example.com', 'Anna Hansen')
    await h.fetch(`/api/clients/${hansen.id}/people`, { ...json({ userId: member.userId }), cookie: admin })
    const client = await join(inv!.token, 'anna@example.com')
    await h.fetch(`/api/public/galleries/${link.token}`, { cookie: client })
    await h.fetch(`/api/public/galleries/${link.token}/picks/${ids[0]}`, { method: 'PUT', cookie: client })

    expect((await h.fetch(`/api/clients/${hansen.id}/erase`, { ...json({ confirm: 'Hansens' }), cookie: admin })).status).toBe(400)
    const erased = await h.fetch(`/api/clients/${hansen.id}/erase`, { ...json({ confirm: 'the hansens' }), cookie: admin })
    expect(await erased.json()).toEqual({ people: 1 })

    expect((await h.fetch(`/api/clients/${hansen.id}`, { cookie: admin })).status).toBe(404)
    expect(await h.env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').bind(member.userId).first<{ n: number }>()).toEqual({ n: 0 })
    // The session is gone with the login.
    expect((await h.fetch('/api/me/galleries', { cookie: client })).status).toBe(401)
    // The gallery and the picks stay, without who made them.
    const visitors = await h.env.DB.prepare('SELECT name, email FROM share_visitors WHERE share_id = ?').bind(link.id).all<{ name: string; email: string | null }>()
    expect(visitors.results).toEqual([{ name: '(erased)', email: null }])
    expect(await h.env.DB.prepare('SELECT COUNT(*) AS n FROM share_picks WHERE share_id = ?').bind(link.id).first<{ n: number }>()).toEqual({ n: 1 })
    // No name or email left in the log about them.
    const log = await h.env.DB.prepare("SELECT action, details FROM activity_log WHERE target_id IN (?, ?) OR user_id = ?").bind(hansen.id, member.userId, member.userId).all<{ action: string; details: string | null }>()
    for (const row of log.results) {
      expect(row.details ?? '', row.action).not.toMatch(/anna|hansen/i)
    }
    expect(log.results.map((r) => r.action)).toContain('client.erased')
  })
})
