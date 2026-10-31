import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanName, nameKey, purgeStale } from '../src/catalog/name-suggestions'
import { cookiesFrom, createHarness, json, setUpAdmin, signIn, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

let h: Harness
let admin: string
/** Four photos in the wedding album, p[0] to p[3], and p[4] outside it. */
let p: string[]
let albumId: string
let smiths: string
let person: Record<string, number>
let link: { id: string; token: string }
/** The couple's two logins, and a planner invited to the same gallery who isn't the client's. */
let jane: string
let john: string
let planner: string

async function upload(filename: string): Promise<string> {
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

const post = async <T>(path: string, body: unknown, cookie = admin): Promise<T> => (await (await h.fetch(path, { ...json(body), cookie })).json()) as T
const put = (path: string, body: unknown, cookie = admin) => h.fetch(path, { method: 'PUT', body: JSON.stringify(body), cookie })
const patch = (path: string, body: unknown, cookie = admin) => h.fetch(path, { method: 'PATCH', body: JSON.stringify(body), cookie })
const count = async (sql: string, ...binds: unknown[]) => ((await h.env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0)

async function client(name: string): Promise<string> {
  return (await post<{ client: { id: string } }>('/api/clients', { name })).client.id
}
async function jobFor(clientId: string): Promise<string> {
  return (await post<{ job: { id: string } }>('/api/jobs', { clientId, title: 'Wedding', kind: 'wedding' })).job.id
}

/** An invited member of `linkId`, joined and signed in; one of `clientId`'s people when given. */
async function member(linkId: string, email: string, name: string, clientId?: string): Promise<string> {
  const { member: m, invite } = await post<{ member: { userId: string }; invite: { token: string } }>(`/api/shares/${linkId}/members`, { name, email })
  if (clientId) expect((await h.fetch(`/api/clients/${clientId}/people`, { ...json({ userId: m.userId }), cookie: admin })).status).toBe(201)
  expect((await h.fetch(`/api/invites/${invite.token}`, json({ password: 'a long client password' }))).status).toBe(200)
  return cookiesFrom(await signIn(h, email, 'a long client password'))
}

interface Gallery {
  items: { id: string; people?: number[]; suggested?: { id: string; label: string; mine: boolean }[] }[]
  people?: { key: number; label: string; kind: string; count: number }[]
  suggesting?: boolean
}
const gallery = async (cookie?: string) => (await (await h.fetch(`/api/public/galleries/${link.token}`, { cookie })).json()) as Gallery
/** As Jane, unless another login (or `null`, signed out) is given. */
const suggestNames = (body: unknown, cookie: string | null = jane) => h.fetch(`/api/public/galleries/${link.token}/names`, { ...json(body), ...(cookie ? { cookie } : {}) })
/** What the couple see waiting, as "label" per photo. */
const waiting = async (cookie = jane) => Object.fromEntries((await gallery(cookie)).items.map((i) => [p.indexOf(i.id), (i.suggested ?? []).map((s) => s.label).join('+')]))

interface Group {
  key: string
  name: string
  person: { id: number; name: string } | null
  candidates: { id: number; name: string; clientName: string | null; where: string }[]
  chosen: number | null
  photos: { assetId: string; by: string[]; names: string[]; alreadyTagged: boolean; suggestionIds: number[] }[]
}
const toCheck = async () => (await (await h.fetch(`/api/shares/${link.id}/names`, { cookie: admin })).json()) as { groups: Group[]; count: number }
const decide = (what: 'accept' | 'reject', body: unknown) => h.fetch(`/api/shares/${link.id}/names/${what}`, { ...json(body), cookie: admin })
const ids = (g: Group) => g.photos.flatMap((ph) => ph.suggestionIds)

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  p = []
  for (let i = 0; i < 5; i++) p.push(await upload(`p${i}.jpg`))
  albumId = (await post<{ album: { id: string } }>('/api/albums', { name: 'Smith wedding' })).album.id
  await h.fetch(`/api/albums/${albumId}/items`, { ...json({ assetIds: p.slice(0, 4) }), cookie: admin })
  smiths = await client('The Smiths')
  await h.env.DB.prepare('UPDATE albums SET job_id = ? WHERE id = ?').bind(await jobFor(smiths), albumId).run()
  person = {}
  for (const name of ['Anna Smith', 'Lily Smith', 'Grandma Rose']) person[name.split(' ')[0]!] = (await post<{ person: { id: number } }>('/api/people', { name })).person.id
  await patch(`/api/people/${person.Lily}`, { isChild: true })
  await h.fetch('/api/assets/bulk', { ...json({ ids: [p[0], p[1]], action: 'person', personId: person.Anna }), cookie: admin })
  await h.fetch('/api/assets/bulk', { ...json({ ids: [p[1]], action: 'person', personId: person.Lily }), cookie: admin })

  link = (await post<{ share: { id: string; token: string } }>('/api/shares', { albumId, name: 'For the Smiths' })).share
  // Showing people the first time lets the couple suggest names too.
  await put(`/api/shares/${link.id}/people`, { peopleShown: true, entries: [{ personId: person.Anna, label: 'Anna' }, { personId: person.Lily, label: 'Lily' }] })
  jane = await member(link.id, 'jane@example.com', 'Jane Smith', smiths)
  john = await member(link.id, 'john@example.com', 'John Smith', smiths)
  planner = await member(link.id, 'pat@example.com', 'Pat Planner')
}, 180_000)
afterEach(async () => h?.dispose())

describe('the couple suggest names', () => {
  it('lets only the couple suggest, and refuses everything else the same way', async () => {
    const theirs = await gallery(jane)
    expect(theirs.suggesting).toBe(true)
    expect(theirs.people!.map((c) => c.label)).toEqual(['Anna'])

    // Anyone but the couple: one fixed refusal, and nothing in their gallery.
    const no = async (cookie: string | null) => {
      const response = await suggestNames({ assetIds: [p[0]], name: 'Aunt Mary' }, cookie)
      return [response.status, ((await response.json()) as { error: string }).error]
    }
    expect(await no(null)).toEqual([403, 'forbidden'])
    expect(await no(planner)).toEqual([403, 'forbidden'])
    expect((await gallery(planner)).suggesting).toBeUndefined()
    expect((await gallery()).items.some((i) => 'suggested' in i)).toBe(false)
    // Another gallery's couple.
    const other = (await post<{ share: { id: string; token: string } }>('/api/shares', { albumId, name: 'Another link' })).share
    await put(`/api/shares/${other.id}/people`, { peopleShown: true })
    const theirsElsewhere = await member(other.id, 'kim@example.com', 'Kim Smith', smiths)
    expect(await no(theirsElsewhere)).toEqual([403, 'forbidden'])

    // A photo that isn't in the gallery, or a chip that isn't what the couple saw: the same answer whatever the reason.
    expect((await suggestNames({ assetIds: [p[4]], name: 'Aunt Mary' })).status).toBe(404)
    expect((await suggestNames({ assetIds: ['no-such-photo'], name: 'Aunt Mary' })).status).toBe(404)
    const anna = theirs.people![0]!
    const changed = async (body: unknown) => {
      const response = await suggestNames(body)
      return [response.status, ((await response.json()) as { error: string }).error]
    }
    expect(await changed({ assetIds: [p[2]], chip: { key: anna.key + 1, label: 'Lily' } })).toEqual([409, 'changed'])
    expect(await changed({ assetIds: [p[2]], chip: { key: anna.key, label: 'Anna Smith' } })).toEqual([409, 'changed'])
    expect(await changed({ assetIds: [p[2]], chip: { key: 99, label: 'Anna' }, personId: person.Grandma })).toEqual([409, 'changed'])
    // A person id on its own is just a missing name.
    expect((await suggestNames({ assetIds: [p[2]], personId: person.Grandma })).status).toBe(400)

    // Off, or people not shown: the same refusal.
    await put(`/api/shares/${link.id}/people`, { suggestionsOn: false })
    expect(await no(jane)).toEqual([403, 'forbidden'])
    expect((await gallery(jane)).suggesting).toBeUndefined()
    await put(`/api/shares/${link.id}/people`, { suggestionsOn: true, peopleShown: false })
    expect(await no(jane)).toEqual([403, 'forbidden'])
  })

  it('takes a chip or a typed name on several photos, cleaned, once each, within limits', async () => {
    const anna = (await gallery(jane)).people![0]!
    expect((await suggestNames({ assetIds: [p[2], p[3]], chip: { key: anna.key, label: 'Anna' } })).status).toBe(201)
    // Zero-width and right-to-left marks are dropped, so these are one name, twice on p[0].
    const made = await suggestNames({ assetIds: [p[0], p[1]], name: '  Aunt​  Mary‮ ' })
    expect(made.status).toBe(201)
    expect(((await made.json()) as { suggested: Record<string, { label: string }[]> }).suggested[p[0]!]!.map((s) => s.label)).toEqual(['Aunt Mary'])
    expect((await suggestNames({ assetIds: [p[0]], name: 'aunt mary' })).status).toBe(201)
    expect(await count('SELECT COUNT(*) AS n FROM name_suggestions')).toBe(4)
    // The couple see what they suggested, as the chip's label, never anyone's full name or id.
    expect(await waiting()).toEqual({ 0: 'Aunt Mary', 1: 'Aunt Mary', 2: 'Anna', 3: 'Anna' })
    const text = JSON.stringify(await gallery(jane))
    for (const hidden of ['Anna Smith', 'Grandma', 'personId', 'person_id', '"id":' + person.Anna]) expect(text).not.toContain(hidden)

    // The other login sees them too, but can take back only their own.
    const johns = (await gallery(john)).items.find((i) => i.id === p[0])!.suggested!
    expect(johns).toEqual([expect.objectContaining({ label: 'Aunt Mary', mine: false })])
    expect((await h.fetch(`/api/public/galleries/${link.token}/names/${johns[0]!.id}`, { method: 'DELETE', cookie: john })).status).toBe(404)
    expect((await h.fetch(`/api/public/galleries/${link.token}/names/${johns[0]!.id}`, { method: 'DELETE', cookie: jane })).status).toBe(204)
    expect(await waiting(john)).toEqual({ 0: '', 1: 'Aunt Mary', 2: 'Anna', 3: 'Anna' })

    // Too long, empty, too many photos.
    expect((await suggestNames({ assetIds: [p[0]], name: 'x'.repeat(81) })).status).toBe(400)
    expect((await suggestNames({ assetIds: [p[0]], name: '​ ‮' })).status).toBe(400)
    expect((await suggestNames({ assetIds: Array.from({ length: 51 }, () => p[0]), name: 'Mary' })).status).toBe(400)

    // 500 waiting per login: at 499, two more photos is one too many.
    await h.env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 495)
       INSERT INTO name_suggestions (public_id, share_id, asset_id, user_id, name, name_key, created_at)
       SELECT lower(hex(randomblob(16))), ?1, ?2, (SELECT user_id FROM share_members WHERE share_id = ?1 ORDER BY rowid LIMIT 1), 'Guest ' || i, 'guest ' || i, ?3 FROM n`,
    )
      .bind(link.id, p[3], new Date().toISOString())
      .run()
    expect(await count('SELECT COUNT(*) AS n FROM name_suggestions')).toBe(499)
    const over = await suggestNames({ assetIds: [p[0], p[1]], name: 'Uncle Bob' })
    expect([over.status, ((await over.json()) as { error: string }).error]).toEqual([409, 'limit'])
    expect((await suggestNames({ assetIds: [p[0]], name: 'Uncle Bob' })).status).toBe(201)
    // John has his own 500.
    expect((await suggestNames({ assetIds: [p[0], p[1]], name: 'Uncle Bob' }, john)).status).toBe(201)
  })

  it('shows nothing to anyone else until the photographer accepts it, and notes it without names', async () => {
    await suggestNames({ assetIds: [p[2]], name: 'Aunt Mary' })
    expect((await gallery(planner)).items.some((i) => 'suggested' in i)).toBe(false)
    expect((await gallery()).items.some((i) => 'suggested' in i)).toBe(false)
    expect((await gallery(jane)).people!.map((c) => c.label)).toEqual(['Anna'])
    // One Activity line an hour, with a count and no names.
    await suggestNames({ assetIds: [p[3]], name: 'Uncle Bob' })
    const { results } = await h.env.DB.prepare("SELECT user_id, details FROM activity_log WHERE action = 'share.names_suggested'").all<{ user_id: string | null; details: string }>()
    expect(results).toHaveLength(1)
    expect(results[0]!.user_id).toBeNull()
    expect(results[0]!.details).not.toMatch(/Mary|Bob|Jane/)
  })
})

describe('Names to check', () => {
  it('groups by name and accepts into someone this client has, or a new person of theirs', async () => {
    const anna = (await gallery(jane)).people![0]!
    await suggestNames({ assetIds: [p[2]], chip: { key: anna.key, label: 'Anna' } })
    // Typing the gallery's label for someone is the same as ticking their chip.
    await suggestNames({ assetIds: [p[3]], name: 'anna' }, john)
    await suggestNames({ assetIds: [p[0], p[2], p[3]], name: 'Aunt Mary' })
    await suggestNames({ assetIds: [p[1]], name: 'Grandma' })

    const { groups, count: waitingNow } = await toCheck()
    expect(waitingNow).toBe(6)
    expect(groups.map((g) => [g.name, g.photos.length])).toEqual([
      ['Aunt Mary', 3],
      ['Anna', 2],
      ['Grandma', 1],
    ])
    const annas = groups.find((g) => g.name === 'Anna')!
    expect(annas.person).toEqual({ id: person.Anna, name: 'Anna Smith' })
    expect(annas.chosen).toBe(person.Anna)
    expect(annas.photos.flatMap((ph) => ph.by).sort()).toEqual(['Jane Smith', 'John Smith'])
    // "Grandma" is the first name of Grandma Rose, who isn't this client's: offered, never pre-chosen.
    const grandma = groups.find((g) => g.name === 'Grandma')!
    expect(grandma.candidates.map((c) => c.name)).toEqual(['Grandma Rose'])
    expect(grandma.chosen).toBeNull()

    // Anna: accepted onto both photos, tagged as suggested by the client.
    const accepted = await decide('accept', { keys: [annas.key], suggestionIds: ids(annas), personId: person.Anna })
    expect(accepted.status).toBe(200)
    expect(((await accepted.json()) as { accepted: number }).accepted).toBe(2)
    expect(await count("SELECT COUNT(*) AS n FROM asset_people WHERE person_id = ? AND how = 'client'", person.Anna)).toBe(2)
    expect((await gallery(jane)).people!.map((c) => `${c.label}:${c.count}`)).toEqual(['Anna:4'])

    // Aunt Mary on two of her three photos, as a new person of this client's, listed in the gallery; p[3] waits.
    await h.env.DB.prepare('UPDATE assets SET indexed_at = ?').bind(new Date().toISOString()).run()
    const mary = (await toCheck()).groups.find((g) => g.name === 'Aunt Mary')!
    const two = mary.photos.filter((ph) => ph.assetId !== p[3]).flatMap((ph) => ph.suggestionIds)
    const made = (await (await decide('accept', { keys: [mary.key], suggestionIds: two, newName: 'Mary O’Brien', listInGallery: true })).json()) as { person: { id: number; created: boolean }; listed: boolean }
    expect(made.person.created).toBe(true)
    expect(made.listed).toBe(true)
    expect(await h.env.DB.prepare('SELECT client_id FROM people WHERE id = ?').bind(made.person.id).first()).toEqual({ client_id: smiths })
    expect((await gallery(jane)).people!.map((c) => c.label)).toEqual(['Anna', 'Mary'])
    expect((await toCheck()).groups.map((g) => [g.name, g.photos.length])).toEqual([
      ['Aunt Mary', 1],
      ['Grandma', 1],
    ])
    // Searched again with the name.
    expect(await count('SELECT COUNT(*) AS n FROM assets WHERE id IN (?, ?) AND indexed_at IS NULL', p[0], p[2])).toBe(2)

    // A new name someone else already has is refused, and they're left as they were.
    const left = (await toCheck()).groups
    const taken = await decide('accept', { keys: [left[1]!.key], suggestionIds: ids(left[1]!), newName: 'Grandma Rose', isChild: true })
    expect(taken.status).toBe(409)
    expect(((await taken.json()) as { error: string; person: { id: number } }).person.id).toBe(person.Grandma)
    expect(await h.env.DB.prepare('SELECT is_child FROM people WHERE id = ?').bind(person.Grandma).first()).toEqual({ is_child: 0 })
    expect(await count('SELECT COUNT(*) AS n FROM asset_people WHERE person_id = ?', person.Grandma)).toBe(0)

    // Rejected: gone, nothing left behind. Activity counts only.
    expect((await decide('reject', { keys: left.map((g) => g.key), suggestionIds: left.flatMap(ids) })).status).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM name_suggestions')).toBe(0)
    const { results } = await h.env.DB.prepare("SELECT details FROM activity_log WHERE action = 'share.names_checked' ORDER BY rowid").all<{ details: string }>()
    expect(results.map((r) => JSON.parse(r.details) as { accepted: number; rejected: number }).map((d) => [d.accepted, d.rejected])).toEqual([
      [2, 0],
      [2, 0],
      [0, 2],
    ])
    for (const r of results) expect(r.details).not.toMatch(/Mary|Anna|Grandma/)
  })

  it('never decides a suggestion that was taken back or changed meanwhile', async () => {
    await suggestNames({ assetIds: [p[2]], name: 'Aunt Mary' })
    const mary = (await toCheck()).groups[0]!
    const theirs = (await gallery(jane)).items.find((i) => i.id === p[2])!.suggested![0]!
    await h.fetch(`/api/public/galleries/${link.token}/names/${theirs.id}`, { method: 'DELETE', cookie: jane })
    await suggestNames({ assetIds: [p[3]], name: 'Uncle Bob' })
    // The old id, with Mary's key: Bob's suggestion isn't touched even if it got the same id.
    const outcome = (await (await decide('accept', { keys: [mary.key], suggestionIds: ids(mary), newName: 'Mary O’Brien' })).json()) as { accepted: number; skipped: number }
    expect(outcome).toMatchObject({ accepted: 0, skipped: 1 })
    expect((await toCheck()).groups.map((g) => g.name)).toEqual(['Uncle Bob'])
    expect(await count('SELECT COUNT(*) AS n FROM asset_people WHERE asset_id = ?', p[3])).toBe(0)
  })

  it('keeps only suggestions from the gallery’s couple, on photos it shows, and tidies the rest', async () => {
    await suggestNames({ assetIds: [p[0], p[1]], name: 'Aunt Mary' })
    await suggestNames({ assetIds: [p[2]], name: 'Uncle Bob' }, john)
    expect((await toCheck()).count).toBe(3)

    // A photo out of the album: gone from the list and the couple's view at once.
    await h.fetch(`/api/albums/${albumId}/items`, { method: 'DELETE', body: JSON.stringify({ assetIds: [p[1]] }), cookie: admin })
    expect((await toCheck()).count).toBe(2)
    expect(await waiting()).toEqual({ 0: 'Aunt Mary', 2: 'Uncle Bob', 3: '' })

    // John no longer the client's: his are gone.
    const johnId = (await h.env.DB.prepare("SELECT id FROM users WHERE email = 'john@example.com'").first<{ id: string }>())!.id
    expect((await h.fetch(`/api/clients/${smiths}/people/${johnId}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    expect((await toCheck()).groups.map((g) => g.name)).toEqual(['Aunt Mary'])

    // The album moves to another client: nothing of the Smiths' shows, and the couple can't add more.
    const joneses = await client('The Joneses')
    await h.env.DB.prepare('UPDATE albums SET job_id = ? WHERE id = ?').bind(await jobFor(joneses), albumId).run()
    expect((await toCheck()).count).toBe(0)
    expect((await suggestNames({ assetIds: [p[0]], name: 'Aunt Mary' })).status).toBe(403)

    // The sweep deletes what can't come back.
    expect(await count('SELECT COUNT(*) AS n FROM name_suggestions')).toBe(3)
    expect(await purgeStale(h.env.DB)).toBe(3)
    expect(await count('SELECT COUNT(*) AS n FROM name_suggestions')).toBe(0)
  })

  it('moves suggestions in a merge, keeps them as text when the person goes, and erases them with the client', async () => {
    const anna = (await gallery(jane)).people![0]!
    await suggestNames({ assetIds: [p[2]], chip: { key: anna.key, label: 'Anna' } })
    const annie = (await post<{ person: { id: number } }>('/api/people', { name: 'Annie Smith' })).person.id
    expect((await h.fetch(`/api/people/${person.Anna}/merge`, { ...json({ into: annie }), cookie: admin })).status).toBe(200)
    expect(await h.env.DB.prepare('SELECT person_id, name FROM name_suggestions').first()).toEqual({ person_id: annie, name: 'Anna' })
    expect((await h.fetch(`/api/people/${annie}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    expect(await h.env.DB.prepare('SELECT person_id, name FROM name_suggestions').first()).toEqual({ person_id: null, name: 'Anna' })

    // A person made from a suggestion is the client's, so erasing the client with their named people removes them.
    await suggestNames({ assetIds: [p[3]], name: 'Aunt Mary' })
    const mary = (await toCheck()).groups.find((g) => g.name === 'Aunt Mary')!
    const made = (await (await decide('accept', { keys: [mary.key], suggestionIds: ids(mary), newName: 'Mary O’Brien' })).json()) as { person: { id: number } }
    await suggestNames({ assetIds: [p[0]], name: 'Uncle Bob' })
    const erased = await h.fetch(`/api/clients/${smiths}/erase`, { ...json({ confirm: 'The Smiths', namedPeople: true }), cookie: admin })
    expect(erased.status).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM name_suggestions')).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM people WHERE id = ?', made.person.id)).toBe(0)
    expect(await count('SELECT suggestions_on AS n FROM shares WHERE id = ?', link.id)).toBe(0)
  })
})

describe('the setting', () => {
  it('turns on with Show people the first time only, and costs the couple no extra round trip', async () => {
    // Set in beforeEach by showing people the first time.
    expect(await count('SELECT suggestions_on AS n FROM shares WHERE id = ?', link.id)).toBe(1)
    const settings = async () => ((await (await h.fetch(`/api/shares/${link.id}/people`, { cookie: admin })).json()) as { people: { suggestionsOn: boolean } }).people
    expect((await settings()).suggestionsOn).toBe(true)
    // The photographer turns it off: showing people again leaves it off.
    await put(`/api/shares/${link.id}/people`, { suggestionsOn: false })
    await put(`/api/shares/${link.id}/people`, { peopleShown: false })
    await put(`/api/shares/${link.id}/people`, { peopleShown: true })
    expect((await settings()).suggestionsOn).toBe(false)
    // Another gallery, never touched: off until people are shown.
    const other = (await post<{ share: { id: string } }>('/api/shares', { albumId, name: 'Second' })).share
    expect(await count('SELECT suggestions_on AS n FROM shares WHERE id = ?', other.id)).toBe(0)

    // The couple's read, with suggestions on and nobody listed: still one round trip more than with people off.
    await put(`/api/shares/${link.id}/people`, { suggestionsOn: true, entries: [] })
    await suggestNames({ assetIds: [p[0]], name: 'Aunt Mary' })
    const on = await h.count(() => gallery(jane))
    expect((await gallery(jane)).suggesting).toBe(true)
    await put(`/api/shares/${link.id}/people`, { peopleShown: false })
    const off = await h.count(() => gallery(jane))
    expect(on.roundTrips - off.roundTrips).toBe(1)
  })
})

describe('names on their own', () => {
  it('drops invisible characters and folds look-alikes, but keeps different names in other scripts apart', () => {
    expect(cleanName(' Ma​ry‮  O’Brien ')).toBe('Mary O’Brien')
    expect(nameKey('Ｍａｒｙ')).toBe(nameKey('mary'))
    expect(nameKey('Müller')).toBe('muller')
    // Devanagari: different vowel signs are different names.
    expect(nameKey('किरण')).not.toBe(nameKey('करण'))
    expect(() => cleanName('x'.repeat(81))).toThrow()
    expect(cleanName('😀'.repeat(80))).toHaveLength(160)
  })
})
