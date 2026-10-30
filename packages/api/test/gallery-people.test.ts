import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeChips, defaultLabel } from '../src/catalog/gallery-people'
import { cookiesFrom, createHarness, createUser, json, setUpAdmin, signIn, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

let h: Harness
let admin: string
/** Five photos in the wedding album, p[0] to p[4]. */
let p: string[]
let albumId: string
let smiths: string
let person: Record<string, number>

async function upload(filename: string): Promise<string> {
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

const post = async <T>(path: string, body: unknown, cookie = admin): Promise<T> => (await (await h.fetch(path, { ...json(body), cookie })).json()) as T
const put = (path: string, body: unknown, cookie = admin) => h.fetch(path, { method: 'PUT', body: JSON.stringify(body), cookie })
const patch = (path: string, body: unknown, cookie = admin) => h.fetch(path, { method: 'PATCH', body: JSON.stringify(body), cookie })

async function client(name: string): Promise<string> {
  return (await post<{ client: { id: string } }>('/api/clients', { name })).client.id
}
async function jobFor(clientId: string): Promise<string> {
  return (await post<{ job: { id: string } }>('/api/jobs', { clientId, title: 'Wedding', kind: 'wedding' })).job.id
}
async function group(clientId: string, name: string, members: string[]): Promise<number> {
  const response = await h.fetch('/api/people/groups', { ...json({ clientId, name, personIds: members.map((m) => person[m]) }), cookie: admin })
  expect(response.status).toBe(201)
  return ((await response.json()) as { group: { id: number } }).group.id
}

/** An invited client of `link`, joined and signed in; linked to `clientId` (one of the couple) when given. */
async function member(linkId: string, email: string, name: string, clientId?: string): Promise<string> {
  const { member: m, invite } = await post<{ member: { userId: string }; invite: { token: string } }>(`/api/shares/${linkId}/members`, { name, email })
  if (clientId) expect((await h.fetch(`/api/clients/${clientId}/people`, { ...json({ userId: m.userId }), cookie: admin })).status).toBe(201)
  expect((await h.fetch(`/api/invites/${invite.token}`, json({ password: 'a long client password' }))).status).toBe(200)
  return cookiesFrom(await signIn(h, email, 'a long client password'))
}

interface Gallery {
  items: { id: string; people?: number[] }[]
  people?: { key: number; label: string; kind: string; count: number }[]
  peopleSignIn?: boolean
}
const gallery = async (token: string, cookie?: string) => (await (await h.fetch(`/api/public/galleries/${token}`, { cookie })).json()) as Gallery
/** Each chip as "label:count", and each photo's chips by label, so a test reads like what the couple sees. */
function seen(g: Gallery) {
  const label = new Map((g.people ?? []).map((c) => [c.key, c.label]))
  return {
    chips: (g.people ?? []).map((c) => `${c.label}:${c.count}`),
    photos: p.map((id) => (g.items.find((i) => i.id === id)?.people ?? []).map((k) => label.get(k)).join('+')),
  }
}

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  p = []
  for (let i = 0; i < 5; i++) p.push(await upload(`p${i}.jpg`))
  albumId = (await post<{ album: { id: string } }>('/api/albums', { name: 'Smith wedding' })).album.id
  await h.fetch(`/api/albums/${albumId}/items`, { ...json({ assetIds: p }), cookie: admin })
  smiths = await client('The Smiths')
  await h.env.DB.prepare('UPDATE albums SET job_id = ? WHERE id = ?').bind(await jobFor(smiths), albumId).run()

  person = {}
  for (const name of ['Anna Smith', 'Ben Smith', 'Lily Smith', 'Tom Smith', 'Grandma Rose', 'Mum Jones', 'Zed Nobody']) {
    person[name.split(' ')[0]!] = (await post<{ person: { id: number } }>('/api/people', { name })).person.id
  }
  for (const child of ['Lily', 'Tom']) await patch(`/api/people/${person[child]}`, { isChild: true })
  await patch(`/api/people/${person.Grandma}`, { hiddenFromClients: true })
  const tag = (photo: number, ...names: string[]) =>
    Promise.all(names.map((n) => h.fetch('/api/assets/bulk', { ...json({ ids: [p[photo]], action: 'person', personId: person[n] }), cookie: admin })))
  await tag(0, 'Anna', 'Ben')
  await tag(1, 'Anna', 'Lily')
  await tag(2, 'Lily', 'Tom')
  await tag(3, 'Mum', 'Lily')
  await tag(4, 'Grandma')
}, 120_000)
afterEach(async () => h?.dispose())

describe('people in a gallery, for the couple', () => {
  async function wedding() {
    const link = await post<{ share: { id: string; token: string } }>('/api/shares', { albumId, name: 'For the Smiths' })
    const groups = {
      couple: await group(smiths, 'The couple', ['Anna', 'Ben']),
      kids: await group(smiths, 'The kids', ['Lily', 'Tom']),
      mumAndLily: await group(smiths, 'Mum and Lily', ['Mum', 'Lily']),
      grandmas: await group(smiths, "Grandma's", ['Grandma', 'Lily']),
    }
    const entries = [
      { groupId: groups.couple, label: 'You two' },
      { groupId: groups.kids, label: 'The kids' },
      { groupId: groups.mumAndLily, label: 'Mum and her girl' },
      { groupId: groups.grandmas, label: "Grandma's" },
      ...['Anna', 'Mum', 'Lily', 'Grandma', 'Zed'].map((n) => ({ personId: person[n], label: n })),
    ]
    expect((await put(`/api/shares/${link.share.id}/people`, { peopleShown: true, entries })).status).toBe(200)
    return { ...link.share, groups }
  }

  it('shows the couple their chips, by the rules, and nobody else anything', async () => {
    const link = await wedding()
    const jane = await member(link.id, 'jane@example.com', 'Jane Smith', smiths)
    const planner = await member(link.id, 'pat@example.com', 'Pat Planner')

    const theirs = await gallery(link.token, jane)
    // Groups first, then people. "Mum and her girl" and "Grandma's" would single Lily out; Lily is a child, Grandma
    // is never shown, and Zed isn't in these photos.
    expect(seen(theirs)).toEqual({
      chips: ['You two:2', 'The kids:3', 'Anna:2', 'Mum:1'],
      photos: ['You two+Anna', 'You two+The kids+Anna', 'The kids', 'The kids+Mum', ''],
    })
    // A number for this response, never an id, and no names beyond the labels.
    expect(theirs.people!.every((c) => Object.keys(c).sort().join() === 'count,key,kind,label')).toBe(true)
    const text = JSON.stringify(theirs)
    for (const hidden of ['Anna Smith', 'Grandma', 'Lily', 'Zed', 'personId', 'groupId']) expect(text).not.toContain(hidden)

    // Anyone else: the gallery as before. A visitor with the link is asked to sign in; a signed-in planner isn't.
    const visitor = await gallery(link.token)
    expect(visitor.people).toBeUndefined()
    expect(visitor.items.some((i) => 'people' in i)).toBe(false)
    expect(visitor.peopleSignIn).toBe(true)
    const pat = await gallery(link.token, planner)
    expect(pat.people).toBeUndefined()
    expect(pat.peopleSignIn).toBeUndefined()
    // Jane's sign-in doesn't open another gallery's people.
    const other = await post<{ share: { id: string; token: string } }>('/api/shares', { albumId, name: 'Another link' })
    await put(`/api/shares/${other.share.id}/people`, { peopleShown: true, entries: [{ personId: person.Anna, label: 'Anna' }] })
    expect((await gallery(other.share.token, jane)).people).toBeUndefined()
  })

  it('applies flags, children, the trash and a moved album on the next read', async () => {
    const link = await wedding()
    const jane = await member(link.id, 'jane@example.com', 'Jane Smith', smiths)

    await patch(`/api/people/${person.Mum}`, { hiddenFromClients: true })
    expect(seen(await gallery(link.token, jane)).chips).toEqual(['You two:2', 'The kids:3', 'Anna:2'])

    // Children named: Lily gets her own chip, and "Mum and her girl" is no longer held back.
    await put(`/api/shares/${link.id}/people`, { childrenNamed: true })
    await patch(`/api/people/${person.Mum}`, { hiddenFromClients: false })
    expect(seen(await gallery(link.token, jane)).chips).toEqual(['You two:2', 'The kids:3', 'Mum and her girl:3', "Grandma's:3", 'Anna:2', 'Mum:1', 'Lily:3'])
    await put(`/api/shares/${link.id}/people`, { childrenNamed: false })

    // A photo in the trash isn't in the gallery: Mum is only on it.
    await h.fetch(`/api/assets/${p[3]}`, { method: 'DELETE', cookie: admin })
    expect(seen(await gallery(link.token, jane)).chips).toEqual(['You two:2', 'The kids:2', 'Anna:2'])

    // Off: nothing, and nobody is asked to sign in.
    await put(`/api/shares/${link.id}/people`, { peopleShown: false })
    expect(await gallery(link.token, jane)).not.toHaveProperty('people')
    expect(await gallery(link.token)).not.toHaveProperty('peopleSignIn')
    await put(`/api/shares/${link.id}/people`, { peopleShown: true })

    // The album moves to another client's job: Jane isn't theirs, and the Smiths' groups don't count there.
    const joneses = await client('The Joneses')
    await h.env.DB.prepare('UPDATE albums SET job_id = ? WHERE id = ?').bind(await jobFor(joneses), albumId).run()
    expect(await gallery(link.token, jane)).not.toHaveProperty('people')
    const settings = ((await (await h.fetch(`/api/shares/${link.id}/people`, { cookie: admin })).json()) as { people: { client: { name: string }; preview: unknown[] } }).people
    expect(settings.client.name).toBe('The Joneses')
    // Their people are still listed, but not the Smiths' groups.
    expect(settings.preview).toEqual([expect.objectContaining({ label: 'Anna' })])
    // An album outside any job shows nobody.
    await h.env.DB.prepare('UPDATE albums SET job_id = NULL WHERE id = ?').bind(albumId).run()
    expect(((await (await h.fetch(`/api/shares/${link.id}/people`, { cookie: admin })).json()) as { people: { client: null; preview: unknown[] } }).people).toMatchObject({ client: null, preview: [] })
  })

  it("gives the photographer a preview, what's left out and why, and warnings", async () => {
    const link = await wedding()
    await h.env.DB.prepare("UPDATE assets SET caption = 'Lily at the party' WHERE id = ?").bind(p[1]).run()
    await put(`/api/shares/${link.id}/people`, {
      entries: [
        { groupId: link.groups.kids, label: 'Lily & Tom' },
        { personId: person.Lily, label: 'Lily' },
        { personId: person.Zed, label: 'Zed' },
      ],
    })
    const { people } = (await (await h.fetch(`/api/shares/${link.id}/people`, { cookie: admin })).json()) as {
      people: {
        client: { name: string }
        entries: { kind: string; name: string; label: string }[]
        tagged: { name: string; photos: number; fromFile: boolean }[]
        groups: { name: string }[]
        preview: { label: string; count: number }[]
        left: { label: string; why: string }[]
        labelWarnings: { label: string; name: string }[]
        captionWarnings: { assetId: string; name: string }[]
      }
    }
    expect(people.client.name).toBe('The Smiths')
    expect(people.entries.map((e) => `${e.kind}:${e.name}:${e.label}`)).toEqual(['group:The kids:Lily & Tom', 'person:Lily Smith:Lily', 'person:Zed Nobody:Zed'])
    expect(people.tagged.map((t) => `${t.name}:${t.photos}`)).toEqual(['Lily Smith:3', 'Anna Smith:2', 'Ben Smith:1', 'Grandma Rose:1', 'Mum Jones:1', 'Tom Smith:1'])
    expect(people.groups.map((g) => g.name)).toEqual(["Grandma's", 'Mum and Lily', 'The couple', 'The kids'])
    expect(people.preview).toEqual([{ label: 'Lily & Tom', kind: 'group', count: 3 }])
    expect(people.left).toEqual([expect.objectContaining({ label: 'Lily', why: 'child' }), expect.objectContaining({ label: 'Zed', why: 'no_photos' })])
    expect(people.labelWarnings).toEqual([{ label: 'Lily & Tom', name: 'Lily Smith' }, { label: 'Lily & Tom', name: 'Tom Smith' }])
    expect(people.captionWarnings).toEqual([expect.objectContaining({ assetId: p[1], name: 'Lily Smith' })])
  })

  it('keeps groups to the gallery’s client and to people who may manage people', async () => {
    const link = await wedding()
    const joneses = await client('The Joneses')
    const theirs = await group(joneses, 'The couple', ['Zed'])
    const refused = await put(`/api/shares/${link.id}/people`, { entries: [{ groupId: theirs, label: 'Them' }] })
    expect(refused.status).toBe(400)
    // Same name for another client is fine; twice for one client isn't.
    expect((await h.fetch('/api/people/groups', { ...json({ clientId: smiths, name: 'the COUPLE' }), cookie: admin })).status).toBe(409)
    // /groups isn't taken for a person's id.
    const all = (await (await h.fetch('/api/people/groups', { cookie: admin })).json()) as { groups: { name: string; clientName: string }[] }
    expect(all.groups.map((g) => `${g.clientName}: ${g.name}`)).toContain('The Joneses: The couple')

    await createUser(h, admin, { name: 'Vic Viewer', email: 'vic@example.com', password: 'a long viewer password', roles: ['viewer'] })
    const viewer = cookiesFrom(await signIn(h, 'vic@example.com', 'a long viewer password'))
    for (const path of [`/api/shares/${link.id}/people`, '/api/people/groups', `/api/people/groups/candidates?client=${smiths}`]) {
      expect((await h.fetch(path, { cookie: viewer })).status, path).toBe(403)
    }
    // An editor (people:manage and shares:manage) can.
    await createUser(h, admin, { name: 'Eve Editor', email: 'eve@example.com', password: 'a long editor password', roles: ['editor'] })
    const editor = cookiesFrom(await signIn(h, 'eve@example.com', 'a long editor password'))
    expect((await h.fetch(`/api/shares/${link.id}/people`, { cookie: editor })).status).toBe(200)
    const candidates = (await (await h.fetch(`/api/people/groups/candidates?client=${smiths}`, { cookie: editor })).json()) as { people: { name: string }[] }
    expect(candidates.people.map((c) => c.name)).not.toContain('Zed Nobody')
    expect(candidates.people.map((c) => c.name)).toContain('Lily Smith')

    // Activity names nobody.
    const { results } = await h.env.DB.prepare("SELECT action, details FROM activity_log WHERE action LIKE 'people_group.%' OR action = 'share.people'").all<{ action: string; details: string | null }>()
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) for (const name of ['couple', 'kids', 'Lily', 'Anna']) expect(r.details ?? '').not.toContain(name)
  })

  it('costs one round trip more for the couple, and none for anyone else', async () => {
    const link = await wedding()
    const jane = await member(link.id, 'jane@example.com', 'Jane Smith', smiths)
    const on = await h.count(() => gallery(link.token, jane))
    const visitorOn = await h.count(() => gallery(link.token))
    await put(`/api/shares/${link.id}/people`, { peopleShown: false })
    const off = await h.count(() => gallery(link.token, jane))
    const visitorOff = await h.count(() => gallery(link.token))
    expect(on.roundTrips - off.roundTrips).toBe(1)
    expect(visitorOn.roundTrips).toBe(visitorOff.roundTrips)
  })

  it('counts only the 2,000 photos the gallery shows, and still costs one round trip more', async () => {
    const link = await wedding()
    const jane = await member(link.id, 'jane@example.com', 'Jane Smith', smiths)
    // 1,995 more photos after the five fill the gallery; one more, with Zed on it, is past what it shows.
    const now = new Date().toISOString()
    const bulk = "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 1995) SELECT printf('bulk-%04d', i) AS id, i FROM n"
    await h.env.DB.batch([
      h.env.DB.prepare(`INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) SELECT id, id || '.jpg', 'image/jpeg', 1, 'ready', ?1, ?1 FROM (${bulk})`).bind(now),
      h.env.DB.prepare(`INSERT INTO album_items (album_id, asset_id, position, added_at) SELECT ?1, id, 1000 + i, ?2 FROM (${bulk})`).bind(albumId, now),
    ])
    const last = 'bulk-1995'
    await h.fetch('/api/assets/bulk', { ...json({ ids: [last], action: 'person', personId: person.Zed }), cookie: admin })

    const theirs = await gallery(link.token, jane)
    expect(theirs.items).toHaveLength(2000)
    expect(seen(theirs).chips).toEqual(['You two:2', 'The kids:3', 'Anna:2', 'Mum:1'])
    // Moved to the front, the same photo is in the gallery, and Zed with it.
    await h.env.DB.prepare('UPDATE album_items SET position = -1 WHERE album_id = ? AND asset_id = ?').bind(albumId, last).run()
    expect(seen(await gallery(link.token, jane)).chips).toContain('Zed:1')

    const on = await h.count(() => gallery(link.token, jane))
    await put(`/api/shares/${link.id}/people`, { peopleShown: false })
    const off = await h.count(() => gallery(link.token, jane))
    expect(on.roundTrips - off.roundTrips).toBe(1)
    expect(on.roundTrips).toBeLessThanOrEqual(50)
    expect(on.statements).toBeLessThanOrEqual(1000)
  }, 120_000)
})

describe('groups elsewhere', () => {
  it('finds a group’s photos in the Library, and “only people in this group are named”', async () => {
    const kids = await group(smiths, 'The kids', ['Lily', 'Tom'])
    const find = async (query: string) => ((await (await h.fetch(`/api/assets?${query}`, { cookie: admin })).json()) as { assets: { id: string }[] }).assets.map((a) => p.indexOf(a.id)).sort()
    expect(await find(`group=${kids}`)).toEqual([1, 2, 3])
    expect(await find(`group=${kids}&only=1`)).toEqual([2])
  })

  it('merges people into groups and galleries, keeping the stricter flags', async () => {
    const link = await post<{ share: { id: string } }>('/api/shares', { albumId, name: 'For the Smiths' })
    const joneses = await client('The Joneses')
    const ben2 = (await post<{ person: { id: number } }>('/api/people', { name: 'Benjamin Smith' })).person.id
    await patch(`/api/people/${ben2}`, { hiddenFromClients: true })
    person.Ben2 = ben2
    const theirs = await group(joneses, 'Friends', ['Ben2'])
    const ours = await group(smiths, 'The couple', ['Anna', 'Ben', 'Ben2'])
    await put(`/api/shares/${link.share.id}/people`, { entries: [{ personId: ben2, label: 'Benjamin' }, { personId: person.Ben, label: 'Ben' }, { groupId: ours, label: 'You two' }] })

    expect((await h.fetch(`/api/people/${ben2}/merge`, { ...json({ into: person.Ben }), cookie: admin })).status).toBe(200)
    const members = async (id: number) => ((await (await h.fetch(`/api/people/groups?client=${id === theirs ? joneses : smiths}`, { cookie: admin })).json()) as { groups: { id: number; members: { name: string }[] }[] }).groups.find((g) => g.id === id)!.members.map((m) => m.name)
    expect(await members(theirs)).toEqual(['Ben Smith'])
    expect(await members(ours)).toEqual(['Anna Smith', 'Ben Smith'])
    const { results } = await h.env.DB.prepare('SELECT person_id, label FROM share_people WHERE share_id = ? AND person_id IS NOT NULL').bind(link.share.id).all()
    expect(results).toEqual([{ person_id: person.Ben, label: 'Ben' }])
    expect(await h.env.DB.prepare('SELECT hidden_from_clients FROM people WHERE id = ?').bind(person.Ben).first()).toEqual({ hidden_from_clients: 1 })
  })

  it('erases a client’s groups and gallery people, and their named people when asked', async () => {
    const link = await post<{ share: { id: string } }>('/api/shares', { albumId, name: 'For the Smiths' })
    const kids = await group(smiths, 'The kids', ['Lily', 'Tom'])
    await put(`/api/shares/${link.share.id}/people`, { peopleShown: true, entries: [{ groupId: kids, label: 'The kids' }, { personId: person.Mum, label: 'Mum' }] })
    await patch(`/api/people/${person.Anna}`, { clientId: smiths })
    await patch(`/api/people/${person.Ben}`, { clientId: smiths })

    const erased = await h.fetch(`/api/clients/${smiths}/erase`, { ...json({ confirm: 'The Smiths', namedPeople: true }), cookie: admin })
    expect(await erased.json()).toEqual({ people: 0, namedPeople: 2 })
    const count = async (sql: string) => ((await h.env.DB.prepare(sql).first<{ n: number }>())?.n ?? 0)
    expect(await count('SELECT COUNT(*) AS n FROM people_groups')).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM share_people')).toBe(0)
    expect(await count('SELECT people_shown AS n FROM shares')).toBe(0)
    expect(await count(`SELECT COUNT(*) AS n FROM people WHERE id IN (${person.Anna}, ${person.Ben})`)).toBe(0)
    // Everyone else stays.
    expect(await count(`SELECT COUNT(*) AS n FROM people WHERE id = ${person.Lily}`)).toBe(1)
  })
})

describe('the rules on their own', () => {
  const flags = (entries: Record<number, [child: boolean, hidden: boolean]>) => new Map(Object.entries(entries).map(([id, [child, hidden]]) => [Number(id), { child, hidden }]))
  const tags = (pairs: [string, number][]) => pairs.map(([asset_id, person_id]) => ({ asset_id, person_id }))

  it('never lets a group, minus the chips beside it, single out one child', () => {
    // Group {1 adult, 2 child, 3 child}; 1 has a chip. Without it, 2 and 3 remain: sent.
    const group = { personId: null, groupId: 9, label: 'Family', position: 0 }
    const adult = { personId: 1, groupId: null, label: 'Mum', position: 1 }
    const f = flags({ 1: [false, false], 2: [true, false], 3: [true, false] })
    const t = tags([['a', 1], ['b', 2], ['c', 3]])
    expect(computeChips([group, adult], new Map([[9, [1, 2, 3]]]), f, t, false).chips.map((c) => c.label)).toEqual(['Family', 'Mum'])
    // Only child 2 is on these photos: the group would be child 2 plus Mum's photos. Held back.
    const held = computeChips([group, adult], new Map([[9, [1, 2, 3]]]), f, tags([['a', 1], ['b', 2]]), false)
    expect(held.chips.map((c) => c.label)).toEqual(['Mum'])
    expect(held.left).toEqual([expect.objectContaining({ why: 'child_rule' })])
    // Children named: no rule needed.
    expect(computeChips([group, adult], new Map([[9, [1, 2, 3]]]), f, tags([['a', 1], ['b', 2]]), true).chips.map((c) => c.label)).toEqual(['Family', 'Mum'])
  })

  it('counts nothing for someone with no photos here, or never shown', () => {
    const f = flags({ 1: [false, true], 2: [false, false] })
    const out = computeChips([{ personId: null, groupId: 9, label: 'G', position: 0 }], new Map([[9, [1, 2]]]), f, tags([['a', 1], ['b', 1]]), false)
    expect(out.chips).toEqual([])
    expect(out.left[0]?.why).toBe('no_photos')
  })

  it('shows the first name, or the part after the comma', () => {
    expect(defaultLabel('Anna Smith')).toBe('Anna')
    expect(defaultLabel('Smith, Anna Maria')).toBe('Anna Maria')
    expect(defaultLabel('Cher')).toBe('Cher')
  })
})
