/**
 * People in client galleries (plans/PLAN-FN-GALLERY-v3.md G1, in cf-dam-docs): groups of people that belong to a
 * client ("Bride's family", "The kids"), and what a gallery shows its client's own invited people so they can find
 * the photos of someone ("Anna", "Bride's family", photos with all of the chips they choose).
 *
 * Who sees it: only the gallery's client's own people (client_people of the client of the album's job), signed in
 * and invited to that gallery, and only when the gallery says so. Everyone else gets the gallery as before.
 *
 * The rules (§5), applied on every read, so a changed flag or a moved album takes effect at once:
 *  - Only photos the gallery shows count (the same order and limit as galleryItems).
 *  - A person marked "never show to clients" is never sent, never makes a group match and is never counted.
 *  - A child has no chip of their own unless the gallery names children; their photos are found through groups.
 *  - A group with a child in it is sent only if at least two of its people on these photos have no chip of their
 *    own, so "The kids" minus "Mum" can't single out one child (chips combine as "all of", never "but not").
 *  - Anything with no photos here is left out.
 * Chips carry a number for this response only, never a person or group id.
 */
import { BadRequest } from '../lib/http'
import { fold } from '../lib/fold'
import { say } from '../lib/language'
import { nowIso } from '../lib/time'
import { GALLERY_ORDER, MAX_GALLERY_ITEMS, type ShareRow } from './shares'

/** The photos a gallery shows, in its order: `?1` the album, `?2` the limit. Shared with galleryItems' order. */
const SHOWN = `shown AS (SELECT ai.asset_id FROM album_items ai JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL
  WHERE ai.album_id = ?1 ORDER BY ${GALLERY_ORDER} LIMIT ?2)`
/** The client a gallery is for: its album's job's client, or null. `?1` the album. */
const CLIENT_OF_ALBUM = '(SELECT j.client_id FROM albums al JOIN jobs j ON j.id = al.job_id WHERE al.id = ?1)'

const MAX_ENTRIES = 100
const MAX_GROUP_MEMBERS = 500
const MAX_LABEL = 60
const MAX_GROUP_NAME = 80

// ---- Groups ----

export interface GroupMember {
  id: number
  name: string
  isChild: boolean
  hidden: boolean
}

export interface GroupJson {
  id: number
  clientId: string
  name: string
  members: GroupMember[]
}

/** A client's groups, A to Z, with their people. */
export async function listGroups(db: D1Database, clientId: string): Promise<GroupJson[]> {
  const [groups, members] = await db.batch([
    db.prepare('SELECT id, client_id, name FROM people_groups WHERE client_id = ? ORDER BY name_key').bind(clientId),
    db
      .prepare(
        `SELECT gm.group_id, p.id, p.name, p.is_child, p.hidden_from_clients FROM people_group_members gm
         JOIN people_groups g ON g.id = gm.group_id JOIN people p ON p.id = gm.person_id
         WHERE g.client_id = ? ORDER BY p.name_key`,
      )
      .bind(clientId),
  ])
  return groupsJson(groups!.results as GroupRow[], members!.results as MemberRow[])
}

/** Every group, for the Library's filter: with the client's name, since two clients can both have "Bride's family". */
export async function allGroups(db: D1Database): Promise<{ id: number; name: string; clientName: string }[]> {
  const { results } = await db
    .prepare('SELECT g.id, g.name, c.name AS client_name FROM people_groups g JOIN clients c ON c.id = g.client_id ORDER BY c.name, g.name_key LIMIT 500')
    .all<{ id: number; name: string; client_name: string }>()
  return results.map((r) => ({ id: r.id, name: r.name, clientName: r.client_name }))
}

interface GroupRow {
  id: number
  client_id: string
  name: string
}
interface MemberRow {
  group_id: number
  id: number
  name: string
  is_child: number
  hidden_from_clients: number
}

function groupsJson(groups: GroupRow[], members: MemberRow[]): GroupJson[] {
  const byGroup = new Map<number, GroupMember[]>()
  for (const m of members) {
    const list = byGroup.get(m.group_id) ?? []
    list.push({ id: m.id, name: m.name, isChild: m.is_child === 1, hidden: m.hidden_from_clients === 1 })
    byGroup.set(m.group_id, list)
  }
  return groups.map((g) => ({ id: g.id, clientId: g.client_id, name: g.name, members: byGroup.get(g.id) ?? [] }))
}

export async function getGroup(db: D1Database, id: number): Promise<GroupJson | null> {
  const [groups, members] = await db.batch([
    db.prepare('SELECT id, client_id, name FROM people_groups WHERE id = ?').bind(id),
    db
      .prepare(
        `SELECT gm.group_id, p.id, p.name, p.is_child, p.hidden_from_clients FROM people_group_members gm JOIN people p ON p.id = gm.person_id
         WHERE gm.group_id = ? ORDER BY p.name_key`,
      )
      .bind(id),
  ])
  return groupsJson(groups!.results as GroupRow[], members!.results as MemberRow[])[0] ?? null
}

/**
 * Who a client's groups are usually made from: the people tagged on photos in the client's jobs' albums, and people
 * linked to the client on their own page. The most photographed first.
 */
export async function groupCandidates(db: D1Database, clientId: string): Promise<(GroupMember & { photos: number })[]> {
  const { results } = await db
    .prepare(
      `WITH theirs AS (
         SELECT ap.person_id, COUNT(DISTINCT ap.asset_id) AS photos FROM jobs j JOIN albums al ON al.job_id = j.id
         JOIN album_items ai ON ai.album_id = al.id JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL
         JOIN asset_people ap ON ap.asset_id = a.id WHERE j.client_id = ?1 GROUP BY ap.person_id)
       SELECT p.id, p.name, p.is_child, p.hidden_from_clients, COALESCE(t.photos, 0) AS photos
       FROM people p LEFT JOIN theirs t ON t.person_id = p.id
       WHERE t.person_id IS NOT NULL OR p.client_id = ?1
       ORDER BY photos DESC, p.name_key LIMIT 500`,
    )
    .bind(clientId)
    .all<{ id: number; name: string; is_child: number; hidden_from_clients: number; photos: number }>()
  return results.map((r) => ({ id: r.id, name: r.name, isChild: r.is_child === 1, hidden: r.hidden_from_clients === 1, photos: r.photos }))
}

const groupName = (value: unknown): string => {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!name || name.length > MAX_GROUP_NAME) throw new BadRequest(say('err.groupName'))
  return name
}

const personIds = (value: unknown): number[] => {
  if (!Array.isArray(value) || value.length > MAX_GROUP_MEMBERS || !value.every((v) => Number.isInteger(v) && v > 0)) {
    throw new BadRequest('personIds must be a list of people.')
  }
  return [...new Set(value as number[])]
}

export interface GroupInput {
  name?: string
  personIds?: number[]
}

export function parseGroupInput(body: Record<string, unknown>, creating: boolean): GroupInput {
  return {
    name: creating || body.name !== undefined ? groupName(body.name) : undefined,
    personIds: body.personIds !== undefined ? personIds(body.personIds) : creating ? [] : undefined,
  }
}

/** Make a group for a client. Null: no such client; 'taken': the client already has a group of that name. */
export async function createGroup(db: D1Database, clientId: string, input: GroupInput, actorId: string | null): Promise<GroupJson | 'taken' | null> {
  if (!(await db.prepare('SELECT 1 FROM clients WHERE id = ?').bind(clientId).first())) return null
  const now = nowIso()
  const made = await db
    .prepare(
      `INSERT INTO people_groups (client_id, name, name_key, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (client_id, name_key) DO NOTHING RETURNING id`,
    )
    .bind(clientId, input.name!, fold(input.name!), actorId, now, now)
    .first<{ id: number }>()
  if (!made) return 'taken'
  if (input.personIds?.length) await setMembers(db, made.id, input.personIds)
  return getGroup(db, made.id)
}

/** Rename a group or set its people. Null: no such group. */
export async function updateGroup(db: D1Database, id: number, input: GroupInput): Promise<GroupJson | 'taken' | null> {
  const group = await db.prepare('SELECT client_id FROM people_groups WHERE id = ?').bind(id).first<{ client_id: string }>()
  if (!group) return null
  if (input.name !== undefined) {
    const other = await db.prepare('SELECT 1 FROM people_groups WHERE client_id = ? AND name_key = ? AND id != ?').bind(group.client_id, fold(input.name), id).first()
    if (other) return 'taken'
    await db.prepare('UPDATE people_groups SET name = ?, name_key = ?, updated_at = ? WHERE id = ?').bind(input.name, fold(input.name), nowIso(), id).run()
  }
  if (input.personIds !== undefined) await setMembers(db, id, input.personIds)
  return getGroup(db, id)
}

async function setMembers(db: D1Database, groupId: number, ids: number[]): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM people_group_members WHERE group_id = ?').bind(groupId),
    // Only people who exist: a deleted one is simply not added.
    db
      .prepare('INSERT OR IGNORE INTO people_group_members (group_id, person_id) SELECT ?, p.id FROM people p WHERE p.id IN (SELECT value FROM json_each(?))')
      .bind(groupId, JSON.stringify(ids)),
    db.prepare('UPDATE people_groups SET updated_at = ? WHERE id = ?').bind(nowIso(), groupId),
  ])
}

/** Delete a group (galleries listing it lose it with it). Returns whether there was one. */
export async function deleteGroup(db: D1Database, id: number): Promise<boolean> {
  return (await db.prepare('DELETE FROM people_groups WHERE id = ? RETURNING id').bind(id).first()) !== null
}

// ---- What the couple sees ----

export interface Chip {
  /** This response's number for it: items list the chips they match by these. */
  key: number
  label: string
  kind: 'group' | 'person'
  /** Photos in the gallery it finds. */
  count: number
}

interface Entry {
  personId: number | null
  groupId: number | null
  label: string
  position: number
}
interface Flags {
  child: boolean
  hidden: boolean
}

export interface ChipResult {
  chips: Chip[]
  /** The chips each photo matches, by photo id. */
  items: Map<string, number[]>
  /** Entries left out, and why: for the photographer's preview, never for clients. */
  left: { entry: Entry; why: 'no_photos' | 'hidden' | 'child' | 'child_rule' }[]
}

/** The rules of §5 over what was read (pure, so it is tested on its own). */
export function computeChips(
  entries: Entry[],
  members: Map<number, number[]>,
  flags: Map<number, Flags>,
  tags: { asset_id: string; person_id: number }[],
  childrenNamed: boolean,
): ChipResult {
  const photosOf = new Map<number, Set<string>>()
  for (const tag of tags) {
    const set = photosOf.get(tag.person_id) ?? new Set<string>()
    set.add(tag.asset_id)
    photosOf.set(tag.person_id, set)
  }
  const flag = (p: number) => flags.get(p) ?? { child: false, hidden: true } // unknown: as if hidden
  const visible = (p: number) => photosOf.has(p) && !flag(p).hidden
  const ownChip = (p: number) => visible(p) && (!flag(p).child || childrenNamed)

  const left: ChipResult['left'] = []
  const sorted = [...entries].sort((a, b) => a.position - b.position)
  const people = sorted.filter((e) => e.personId !== null)
  const groups = sorted.filter((e) => e.groupId !== null)

  const personChips: { entry: Entry; person: number }[] = []
  for (const entry of people) {
    const p = entry.personId!
    if (flag(p).hidden) left.push({ entry, why: 'hidden' })
    else if (!photosOf.has(p)) left.push({ entry, why: 'no_photos' })
    else if (!ownChip(p)) left.push({ entry, why: 'child' })
    else personChips.push({ entry, person: p })
  }
  const chipped = new Set(personChips.map((c) => c.person))

  const groupChips: { entry: Entry; matching: number[] }[] = []
  for (const entry of groups) {
    const matching = (members.get(entry.groupId!) ?? []).filter(visible)
    if (matching.length === 0) {
      left.push({ entry, why: 'no_photos' })
      continue
    }
    if (!childrenNamed && matching.some((p) => flag(p).child) && matching.filter((p) => !chipped.has(p)).length < 2) {
      left.push({ entry, why: 'child_rule' })
      continue
    }
    groupChips.push({ entry, matching })
  }

  const chips: Chip[] = []
  const items = new Map<string, number[]>()
  const mark = (asset: string, key: number) => {
    const keys = items.get(asset) ?? []
    if (!keys.includes(key)) keys.push(key)
    items.set(asset, keys)
  }
  for (const g of groupChips) {
    const key = chips.length
    const photos = new Set<string>()
    for (const p of g.matching) for (const asset of photosOf.get(p)!) photos.add(asset)
    for (const asset of photos) mark(asset, key)
    chips.push({ key, label: g.entry.label, kind: 'group', count: photos.size })
  }
  for (const c of personChips) {
    const key = chips.length
    const photos = photosOf.get(c.person)!
    for (const asset of photos) mark(asset, key)
    chips.push({ key, label: c.entry.label, kind: 'person', count: photos.size })
  }
  return { chips, items, left }
}

/**
 * What a gallery shows of people: for `viewer` (a signed-in member) only if they are the gallery's client's own
 * person; 'team' reads it as the couple would see it, for the photographer's preview. One round trip.
 */
export async function galleryPeople(db: D1Database, share: Pick<ShareRow, 'id' | 'album_id' | 'children_named'>, viewer: { userId: string } | 'team'): Promise<ChipResult> {
  const team = viewer === 'team' ? 1 : 0
  const userId = viewer === 'team' ? '' : viewer.userId
  const [entries, people, tags] = await db.batch([
    // The gallery's list, only for its client's own people, and only groups of that client.
    db
      .prepare(
        `SELECT sp.person_id, sp.group_id, sp.label, sp.position FROM share_people sp
         WHERE sp.share_id = ?3 AND ${CLIENT_OF_ALBUM} IS NOT NULL
           AND (sp.group_id IS NULL OR sp.group_id IN (SELECT g.id FROM people_groups g WHERE g.client_id = ${CLIENT_OF_ALBUM}))
           AND (?4 = 1 OR EXISTS (SELECT 1 FROM client_people cp WHERE cp.user_id = ?5 AND cp.client_id = ${CLIENT_OF_ALBUM}))`,
      )
      .bind(share.album_id, MAX_GALLERY_ITEMS, share.id, team, userId),
    db
      .prepare(
        `SELECT NULL AS group_id, p.id, p.is_child, p.hidden_from_clients FROM share_people sp JOIN people p ON p.id = sp.person_id WHERE sp.share_id = ?1
         UNION ALL
         SELECT gm.group_id, p.id, p.is_child, p.hidden_from_clients FROM share_people sp JOIN people_group_members gm ON gm.group_id = sp.group_id
           JOIN people p ON p.id = gm.person_id WHERE sp.share_id = ?1`,
      )
      .bind(share.id),
    db
      .prepare(
        `WITH ${SHOWN},
         wanted AS (SELECT sp.person_id FROM share_people sp WHERE sp.share_id = ?3 AND sp.person_id IS NOT NULL
                    UNION SELECT gm.person_id FROM share_people sp JOIN people_group_members gm ON gm.group_id = sp.group_id WHERE sp.share_id = ?3)
         SELECT ap.asset_id, ap.person_id FROM shown JOIN asset_people ap ON ap.asset_id = shown.asset_id WHERE ap.person_id IN (SELECT person_id FROM wanted)`,
      )
      .bind(share.album_id, MAX_GALLERY_ITEMS, share.id),
  ])
  const rows = entries!.results as { person_id: number | null; group_id: number | null; label: string; position: number }[]
  if (rows.length === 0) return { chips: [], items: new Map(), left: [] }
  const members = new Map<number, number[]>()
  const flags = new Map<number, Flags>()
  for (const r of people!.results as { group_id: number | null; id: number; is_child: number; hidden_from_clients: number }[]) {
    flags.set(r.id, { child: r.is_child === 1, hidden: r.hidden_from_clients === 1 })
    if (r.group_id !== null) members.set(r.group_id, [...(members.get(r.group_id) ?? []), r.id])
  }
  return computeChips(
    rows.map((r) => ({ personId: r.person_id, groupId: r.group_id, label: r.label, position: r.position })),
    members,
    flags,
    tags!.results as { asset_id: string; person_id: number }[],
    share.children_named === 1,
  )
}

// ---- The photographer's settings ----

/** "Anna" from "Anna Smith", "Anna" from "Smith, Anna": the name a gallery shows unless changed. */
export function defaultLabel(name: string): string {
  const comma = name.indexOf(',')
  const given = comma > 0 ? name.slice(comma + 1).trim() : ''
  return (given || name.trim().split(/\s+/)[0] || name).slice(0, MAX_LABEL)
}

export interface SharePeopleEntry {
  kind: 'person' | 'group'
  id: number
  /** The person's or group's own name, for the photographer. */
  name: string
  label: string
  isChild: boolean
  hidden: boolean
}

export interface SharePeopleJson {
  /** The gallery's client (album → job → client), or null: then it can't show people. */
  client: { id: string; name: string } | null
  peopleShown: boolean
  childrenNamed: boolean
  entries: SharePeopleEntry[]
  /** People tagged on the gallery's photos, the most photographed first. */
  tagged: (GroupMember & { photos: number; fromFile: boolean })[]
  groups: GroupJson[]
  /** Exactly what the couple gets. */
  preview: { label: string; kind: 'group' | 'person'; count: number }[]
  /** What's listed but not shown, and why. */
  left: { kind: 'person' | 'group'; id: number; label: string; why: ChipResult['left'][number]['why'] }[]
  /** A label that names a child or hidden person in its group. */
  labelWarnings: { label: string; name: string }[]
  /** Photos whose title, caption or alt text names someone tagged on them. */
  captionWarnings: { assetId: string; filename: string; name: string }[]
}

type SharePeopleShare = Pick<ShareRow, 'id' | 'album_id' | 'people_shown' | 'children_named'>

export async function sharePeople(db: D1Database, share: SharePeopleShare): Promise<SharePeopleJson> {
  const [client, entries, tagged, texts] = await db.batch([
    db.prepare(`SELECT c.id, c.name FROM clients c WHERE c.id = ${CLIENT_OF_ALBUM}`).bind(share.album_id),
    db
      .prepare(
        `SELECT sp.person_id, sp.group_id, sp.label, sp.position, COALESCE(p.name, g.name) AS name, p.is_child, p.hidden_from_clients
         FROM share_people sp LEFT JOIN people p ON p.id = sp.person_id LEFT JOIN people_groups g ON g.id = sp.group_id
         WHERE sp.share_id = ? ORDER BY sp.position`,
      )
      .bind(share.id),
    db
      .prepare(
        `WITH ${SHOWN}
         SELECT p.id, p.name, p.is_child, p.hidden_from_clients, COUNT(*) AS photos, MIN(ap.how = 'file') AS from_file
         FROM shown JOIN asset_people ap ON ap.asset_id = shown.asset_id JOIN people p ON p.id = ap.person_id
         GROUP BY p.id ORDER BY photos DESC, p.name_key LIMIT 300`,
      )
      .bind(share.album_id, MAX_GALLERY_ITEMS),
    db
      .prepare(
        `WITH ${SHOWN}
         SELECT a.id, a.filename, a.title, a.caption, a.alt, p.name FROM shown JOIN assets a ON a.id = shown.asset_id
         JOIN asset_people ap ON ap.asset_id = a.id JOIN people p ON p.id = ap.person_id
         WHERE COALESCE(a.title, '') || COALESCE(a.caption, '') || COALESCE(a.alt, '') != ''`,
      )
      .bind(share.album_id, MAX_GALLERY_ITEMS),
  ])
  const owner = (client!.results as { id: string; name: string }[])[0] ?? null
  const [groups, chips] = await Promise.all([owner ? listGroups(db, owner.id) : Promise.resolve([]), galleryPeople(db, share, 'team')])
  const listed = (entries!.results as { person_id: number | null; group_id: number | null; label: string; name: string; is_child: number | null; hidden_from_clients: number | null }[]).map(
    (r): SharePeopleEntry => ({
      kind: r.group_id !== null ? 'group' : 'person',
      id: (r.group_id ?? r.person_id)!,
      name: r.name,
      label: r.label,
      isChild: r.is_child === 1,
      hidden: r.hidden_from_clients === 1,
    }),
  )

  const labelWarnings: SharePeopleJson['labelWarnings'] = []
  for (const entry of listed.filter((e) => e.kind === 'group')) {
    const members = groups.find((g) => g.id === entry.id)?.members ?? []
    for (const m of members) if ((m.isChild && !share.children_named) || m.hidden) if (names(entry.label, m.name)) labelWarnings.push({ label: entry.label, name: m.name })
  }

  const captionWarnings: SharePeopleJson['captionWarnings'] = []
  for (const r of texts!.results as { id: string; filename: string; title: string | null; caption: string | null; alt: string | null; name: string }[]) {
    if (captionWarnings.length >= 50) break
    if (names([r.title, r.caption, r.alt].filter(Boolean).join(' '), r.name)) captionWarnings.push({ assetId: r.id, filename: r.filename, name: r.name })
  }

  return {
    client: owner,
    peopleShown: share.people_shown === 1,
    childrenNamed: share.children_named === 1,
    entries: listed,
    tagged: (tagged!.results as { id: number; name: string; is_child: number; hidden_from_clients: number; photos: number; from_file: number }[]).map((r) => ({
      id: r.id,
      name: r.name,
      isChild: r.is_child === 1,
      hidden: r.hidden_from_clients === 1,
      photos: r.photos,
      fromFile: r.from_file === 1,
    })),
    groups,
    preview: chips.chips.map((c) => ({ label: c.label, kind: c.kind, count: c.count })),
    left: chips.left.map((l) => ({ kind: l.entry.groupId !== null ? 'group' : 'person', id: (l.entry.groupId ?? l.entry.personId)!, label: l.entry.label, why: l.why })),
    labelWarnings,
    captionWarnings,
  }
}

/** Whether `text` contains the person's name, or the first word of it (two letters or more), as a whole word. */
function names(text: string, name: string): boolean {
  const words = ` ${fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  const full = fold(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const first = defaultLabel(name)
  const firstKey = fold(first).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return (full.length > 1 && words.includes(` ${full} `)) || (firstKey.length > 1 && words.includes(` ${firstKey} `))
}

export interface SharePeopleInput {
  peopleShown?: boolean
  childrenNamed?: boolean
  entries?: { personId: number | null; groupId: number | null; label: string }[]
}

export function parseSharePeople(body: Record<string, unknown>): SharePeopleInput {
  const input: SharePeopleInput = {}
  for (const field of ['peopleShown', 'childrenNamed'] as const) {
    if (body[field] === undefined) continue
    if (typeof body[field] !== 'boolean') throw new BadRequest(`${field} must be true or false.`)
    input[field] = body[field]
  }
  if (body.entries !== undefined) {
    if (!Array.isArray(body.entries) || body.entries.length > MAX_ENTRIES) throw new BadRequest(`entries is a list of up to ${MAX_ENTRIES}.`)
    input.entries = body.entries.map((raw) => {
      const e = (raw ?? {}) as Record<string, unknown>
      const personId = Number.isInteger(e.personId) && (e.personId as number) > 0 ? (e.personId as number) : null
      const groupId = Number.isInteger(e.groupId) && (e.groupId as number) > 0 ? (e.groupId as number) : null
      if ((personId === null) === (groupId === null)) throw new BadRequest('Each entry is a person or a group.')
      const label = typeof e.label === 'string' ? e.label.replace(/\s+/g, ' ').trim() : ''
      if (!label || label.length > MAX_LABEL) throw new BadRequest(say('err.peopleLabel'))
      return { personId, groupId, label }
    })
  }
  return input
}

/**
 * Save a gallery's people settings. Groups must be the gallery's client's (checked again on every read, as an album
 * can move to another job). 'wrong_group': a group isn't this gallery's client's (or the gallery has no client).
 */
export async function setSharePeople(db: D1Database, share: Pick<ShareRow, 'id' | 'album_id'>, input: SharePeopleInput): Promise<'ok' | 'wrong_group'> {
  const statements: D1PreparedStatement[] = []
  if (input.entries) {
    const groupIds = input.entries.filter((e) => e.groupId !== null).map((e) => e.groupId!)
    if (groupIds.length) {
      const ok = await db
        .prepare(`SELECT COUNT(*) AS n FROM people_groups WHERE id IN (SELECT value FROM json_each(?2)) AND client_id = ${CLIENT_OF_ALBUM}`)
        .bind(share.album_id, JSON.stringify([...new Set(groupIds)]))
        .first<{ n: number }>()
      if (ok?.n !== new Set(groupIds).size) return 'wrong_group'
    }
    const rows = input.entries.map((e, position) => ({ ...e, position }))
    statements.push(
      db.prepare('DELETE FROM share_people WHERE share_id = ?').bind(share.id),
      // People who no longer exist are left out; a repeated entry keeps its first place.
      db
        .prepare(
          `INSERT OR IGNORE INTO share_people (share_id, person_id, group_id, label, position)
           SELECT ?1, json_extract(j.value, '$.personId'), json_extract(j.value, '$.groupId'), json_extract(j.value, '$.label'), json_extract(j.value, '$.position')
           FROM json_each(?2) j
           WHERE (json_extract(j.value, '$.personId') IN (SELECT id FROM people)) OR (json_extract(j.value, '$.groupId') IN (SELECT id FROM people_groups))`,
        )
        .bind(share.id, JSON.stringify(rows)),
    )
  }
  const sets: string[] = []
  const binds: unknown[] = []
  const set = (column: string, value: boolean | undefined) => {
    if (value === undefined) return
    sets.push(`${column} = ?`)
    binds.push(value ? 1 : 0)
  }
  set('people_shown', input.peopleShown)
  set('children_named', input.childrenNamed)
  if (sets.length) statements.push(db.prepare(`UPDATE shares SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...binds, nowIso(), share.id))
  if (statements.length) await db.batch(statements)
  return 'ok'
}
