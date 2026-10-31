/**
 * The couple suggests names (plans/PLAN-G2-v2.md, in cf-dam-docs): a gallery's client's own invited people say who
 * is on its photos, by ticking one of the gallery's person chips or typing a name. Nothing is tagged until someone
 * who manages people accepts it in Names to check; accepting tags the photos (`asset_people.how = 'client'`) and
 * deletes the suggestions, rejecting just deletes them. Only waiting suggestions are kept.
 *
 * A suggestion is live while its author is still a member of the gallery and one of the people of the gallery's
 * current client, and its photo is one the gallery shows (`SHOWN`). Everything here counts only live ones; the rest
 * are deleted by the next decision on that gallery and by the sweep, so an album moved to another client loses the
 * old client's suggestions at once.
 *
 * The couple never send or get a person id: a chip is sent back as its key and label and checked again here, and
 * every refusal about a chip, a photo or a suggestion is the same whatever the reason.
 */
import { BadRequest } from '../lib/http'
import { fold } from '../lib/fold'
import { say } from '../lib/language'
import { nowIso } from '../lib/time'
import { CLIENT_OF_ALBUM, defaultLabel, galleryPeople, MAX_ENTRIES, SHOWN } from './gallery-people'
import { MAX_GALLERY_ITEMS, type ShareRow } from './shares'

export const MAX_NAME = 80
/** Photos one suggestion can name at once. */
export const MAX_PHOTOS = 50
export const MAX_PER_PERSON = 500
export const MAX_PER_GALLERY = 1000
/** Suggestions one accept or reject may decide. */
export const MAX_DECIDE = 1000

/**
 * Live suggestions of a gallery, as `ns`: `?1` the album, `?2` the photo limit and `?3` the gallery, with `shown`
 * from `SHOWN` in the statement's WITH.
 */
const LIVE = `ns.share_id = ?3 AND ns.asset_id IN (SELECT asset_id FROM shown)
  AND EXISTS (SELECT 1 FROM share_members sm WHERE sm.share_id = ns.share_id AND sm.user_id = ns.user_id)
  AND EXISTS (SELECT 1 FROM client_people cp WHERE cp.user_id = ns.user_id AND cp.client_id = ${CLIENT_OF_ALBUM})`

/** The same rule for every gallery at once, without the 2,000-photo cutoff (the sweep and the list's counts). */
const LIVE_ANYWHERE = `EXISTS (SELECT 1 FROM share_members sm WHERE sm.share_id = ns.share_id AND sm.user_id = ns.user_id)
  AND EXISTS (SELECT 1 FROM shares s JOIN albums al ON al.id = s.album_id JOIN jobs j ON j.id = al.job_id
              JOIN client_people cp ON cp.client_id = j.client_id AND cp.user_id = ns.user_id WHERE s.id = ns.share_id)
  AND EXISTS (SELECT 1 FROM shares s JOIN album_items ai ON ai.album_id = s.album_id AND ai.asset_id = ns.asset_id
              JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL WHERE s.id = ns.share_id)`

type GalleryShare = Pick<ShareRow, 'id' | 'album_id' | 'children_named' | 'people_shown' | 'suggestions_on'>

/** Whether the gallery takes suggestions at all (the couple is checked separately). */
export const suggestionsOpen = (share: Pick<ShareRow, 'people_shown' | 'suggestions_on' | 'revoked_at'>) =>
  share.people_shown === 1 && share.suggestions_on === 1 && share.revoked_at === null

// ---- Names ----

/** Writing systems whose accents and vowel signs `fold` may strip without merging different names. */
const FOLDABLE = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]*$/u

/** A name as typed, made safe to keep and show: no control or invisible characters (zero-width, bidi), one space. */
export function cleanName(raw: unknown, max = MAX_NAME): string {
  const name = typeof raw === 'string' ? raw.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim() : ''
  if (!name || [...name].length > max) throw new BadRequest(say('err.suggestedName', { max }))
  return name
}

/** What makes two suggested names the same: "Ｍａｒｙ", "mary" and "Mary" are; "Mary" and "Ma​ry" are too. */
export function nameKey(name: string): string {
  const plain = name.normalize('NFKC')
  return FOLDABLE.test(plain) ? fold(plain) : plain.toLowerCase()
}

// ---- The couple ----

export interface Suggested {
  /** Random, for taking it back. */
  id: string
  label: string
  /** Made by this login (the couple's other login can't take it back). */
  mine: boolean
}

/** The couple's live suggestions (either login's), for the gallery read: `?4` the viewer. Empty for anyone else. */
export function coupleSuggestions(db: D1Database, share: Pick<ShareRow, 'id' | 'album_id'>, userId: string, assetIds?: string[]): D1PreparedStatement {
  return db
    .prepare(
      `WITH ${SHOWN} SELECT ns.public_id, ns.asset_id, ns.name, ns.user_id = ?4 AS mine FROM name_suggestions ns
       WHERE ${LIVE} AND EXISTS (SELECT 1 FROM client_people cp WHERE cp.user_id = ?4 AND cp.client_id = ${CLIENT_OF_ALBUM})
         AND (?5 IS NULL OR ns.asset_id IN (SELECT value FROM json_each(?5)))
       ORDER BY ns.id LIMIT ${MAX_PER_GALLERY}`,
    )
    .bind(share.album_id, MAX_GALLERY_ITEMS, share.id, userId, assetIds ? JSON.stringify(assetIds) : null)
}

export interface SuggestionRow {
  public_id: string
  asset_id: string
  name: string
  mine: number
}

/** Rows from `coupleSuggestions`, by photo. */
export function suggestedByPhoto(rows: SuggestionRow[]): Map<string, Suggested[]> {
  const byPhoto = new Map<string, Suggested[]>()
  for (const r of rows) byPhoto.set(r.asset_id, [...(byPhoto.get(r.asset_id) ?? []), { id: r.public_id, label: r.name, mine: r.mine === 1 }])
  return byPhoto
}

export interface SuggestInput {
  assetIds: string[]
  chip: { key: number; label: string } | null
  name: string | null
}

export function parseSuggestion(body: Record<string, unknown>): SuggestInput {
  const assetIds = body.assetIds
  if (!Array.isArray(assetIds) || assetIds.length === 0 || assetIds.length > MAX_PHOTOS || !assetIds.every((a) => typeof a === 'string' && a.length > 0 && a.length <= 64)) {
    throw new BadRequest(say('err.suggestPhotos', { max: MAX_PHOTOS }))
  }
  const chip = body.chip as Record<string, unknown> | undefined
  if (chip && typeof chip === 'object') {
    if (!Number.isInteger(chip.key) || typeof chip.label !== 'string') throw new BadRequest(say('err.suggestedName', { max: MAX_NAME }))
    return { assetIds: [...new Set(assetIds as string[])], chip: { key: chip.key as number, label: chip.label }, name: null }
  }
  return { assetIds: [...new Set(assetIds as string[])], chip: null, name: cleanName(body.name) }
}

export type SuggestOutcome = { suggested: Map<string, Suggested[]> } | 'not_couple' | 'chip_changed' | 'not_in_gallery' | 'limit'

/** The couple say who is on some photos. One fixed refusal per kind; nothing about anyone else is revealed. */
export async function suggest(db: D1Database, share: GalleryShare, member: { userId: string }, input: SuggestInput): Promise<SuggestOutcome> {
  const people = await galleryPeople(db, share, member)
  if (!people.isCouple) return 'not_couple'
  let personId: number | null = null
  let name: string
  if (input.chip) {
    const chip = people.chips[input.chip.key]
    const person = people.chipPerson.get(input.chip.key)
    if (!chip || chip.kind !== 'person' || person === undefined || chip.label !== input.chip.label) return 'chip_changed'
    personId = person
    name = chip.label
  } else {
    name = input.name!
  }
  const ids = JSON.stringify(input.assetIds)
  const present = await db
    .prepare(`WITH ${SHOWN} SELECT COUNT(*) AS n FROM json_each(?3) j WHERE j.value IN (SELECT asset_id FROM shown)`)
    .bind(share.album_id, MAX_GALLERY_ITEMS, ids)
    .first<{ n: number }>()
  if (present?.n !== input.assetIds.length) return 'not_in_gallery'

  const key = nameKey(name)
  // The limits are checked in the insert itself, so two quick sends can't both pass.
  const made = await db
    .prepare(
      `WITH ${SHOWN}, live AS (SELECT ns.user_id FROM name_suggestions ns WHERE ${LIVE})
       INSERT INTO name_suggestions (public_id, share_id, asset_id, user_id, person_id, name, name_key, created_at)
       SELECT lower(hex(randomblob(16))), ?3, j.value, ?4, ?5, ?6, ?7, ?8 FROM json_each(?9) j
       WHERE (SELECT COUNT(*) FROM live WHERE user_id = ?4) + json_array_length(?9) <= ${MAX_PER_PERSON}
         AND (SELECT COUNT(*) FROM live) + json_array_length(?9) <= ${MAX_PER_GALLERY}
       ON CONFLICT DO NOTHING`,
    )
    .bind(share.album_id, MAX_GALLERY_ITEMS, share.id, member.userId, personId, name, key, nowIso(), ids)
    .run()
  if (made.meta.changes === 0) {
    // Nothing new: either all already suggested (fine), or a limit.
    const already = await db
      .prepare('SELECT COUNT(*) AS n FROM name_suggestions WHERE share_id = ? AND user_id = ? AND name_key = ? AND asset_id IN (SELECT value FROM json_each(?))')
      .bind(share.id, member.userId, key, ids)
      .first<{ n: number }>()
    if (already?.n !== input.assetIds.length) return 'limit'
  }
  const { results } = await coupleSuggestions(db, share, member.userId, input.assetIds).all<SuggestionRow>()
  return { suggested: suggestedByPhoto(results) }
}

/** Take back one of your own waiting suggestions. False for anything else, whatever the reason. */
export async function takeBack(db: D1Database, share: Pick<ShareRow, 'id'>, userId: string, publicId: string): Promise<boolean> {
  if (!/^[0-9a-f]{32}$/.test(publicId)) return false
  const gone = await db.prepare('DELETE FROM name_suggestions WHERE public_id = ? AND share_id = ? AND user_id = ? RETURNING id').bind(publicId, share.id, userId).first()
  return gone !== null
}

// ---- Names to check ----

export interface Candidate {
  id: number
  name: string
  /** The client they're linked to, when it isn't this gallery's. */
  clientName: string | null
  where: 'gallery' | 'client' | 'archive'
}

export interface NameGroup {
  /** Sent back with the ids, so ids reused meanwhile can't name the wrong people. */
  key: string
  /** As the couple wrote it (the first spelling), or the chip label. */
  name: string
  /** Set when the couple ticked someone's chip, or wrote the label of someone this gallery lists. */
  person: { id: number; name: string } | null
  candidates: Candidate[]
  /** Pre-chosen: only ever someone this gallery lists or this client's own. */
  chosen: number | null
  photos: { assetId: string; filename: string; by: string[]; names: string[]; alreadyTagged: boolean; suggestionIds: number[] }[]
}

interface LiveRow {
  id: number
  asset_id: string
  name: string
  name_key: string
  person_id: number | null
  person_name: string | null
  by_name: string
  filename: string
}

interface Listed {
  person_id: number
  label: string
  name: string
}

/** Which group a suggestion belongs to: the person it names (by chip, or by this gallery's label), or its name. */
function groupKey(row: Pick<LiveRow, 'person_id' | 'name_key'>, listed: Listed[]): string {
  if (row.person_id !== null) return `p${row.person_id}`
  const match = listed.find((l) => nameKey(l.label) === row.name_key || nameKey(l.name) === row.name_key)
  return match ? `p${match.person_id}` : `n${row.name_key}`
}

const liveRows = (db: D1Database, share: Pick<ShareRow, 'id' | 'album_id'>, ids?: number[]) =>
  db
    .prepare(
      `WITH ${SHOWN} SELECT ns.id, ns.asset_id, ns.name, ns.name_key, ns.person_id, p.name AS person_name, u.name AS by_name, a.filename
       FROM name_suggestions ns JOIN users u ON u.id = ns.user_id JOIN assets a ON a.id = ns.asset_id LEFT JOIN people p ON p.id = ns.person_id
       WHERE ${LIVE} AND (?4 IS NULL OR ns.id IN (SELECT value FROM json_each(?4)))
       ORDER BY ns.id LIMIT ${MAX_PER_GALLERY}`,
    )
    .bind(share.album_id, MAX_GALLERY_ITEMS, share.id, ids ? JSON.stringify(ids) : null)

const listedPeople = (db: D1Database, share: Pick<ShareRow, 'id'>) =>
  db.prepare('SELECT sp.person_id, sp.label, p.name FROM share_people sp JOIN people p ON p.id = sp.person_id WHERE sp.share_id = ?').bind(share.id)

/** Everything waiting on a gallery, grouped by the name suggested, with who it might be. Two round trips. */
export async function namesToCheck(db: D1Database, share: Pick<ShareRow, 'id' | 'album_id'>): Promise<{ groups: NameGroup[]; count: number }> {
  const [rowsResult, listedResult, client, tagsResult] = await db.batch([
    liveRows(db, share),
    listedPeople(db, share),
    db.prepare(`SELECT c.id, c.name FROM clients c WHERE c.id = ${CLIENT_OF_ALBUM}`).bind(share.album_id),
    db
      .prepare(
        `WITH ${SHOWN} SELECT ap.asset_id, ap.person_id, p.name FROM asset_people ap JOIN people p ON p.id = ap.person_id
         WHERE ap.asset_id IN (SELECT ns.asset_id FROM name_suggestions ns WHERE ${LIVE})`,
      )
      .bind(share.album_id, MAX_GALLERY_ITEMS, share.id),
  ])
  const rows = rowsResult!.results as unknown as LiveRow[]
  if (rows.length === 0) return { groups: [], count: 0 }
  const listed = listedResult!.results as unknown as Listed[]
  const owner = (client!.results as { id: string; name: string }[])[0] ?? null
  const onPhoto = new Map<string, { id: number; name: string }[]>()
  for (const t of tagsResult!.results as { asset_id: string; person_id: number; name: string }[]) {
    onPhoto.set(t.asset_id, [...(onPhoto.get(t.asset_id) ?? []), { id: t.person_id, name: t.name }])
  }

  // Candidates for typed names: people whose name or first name is the typed name, here, the client's, or anywhere.
  const typedKeys = [...new Set(rows.filter((r) => groupKey(r, listed).startsWith('n')).map((r) => r.name_key))]
  const found = typedKeys.length
    ? (
        await db
          .prepare(
            `SELECT DISTINCT p.id, p.name, p.name_key, p.client_id, c.name AS client_name FROM json_each(?1) k
             JOIN people p ON p.name_key = k.value OR p.name_key LIKE replace(replace(k.value, '%', '\\%'), '_', '\\_') || ' %' ESCAPE '\\'
               OR p.name_key LIKE '%, ' || replace(replace(k.value, '%', '\\%'), '_', '\\_') ESCAPE '\\'
             LEFT JOIN clients c ON c.id = p.client_id
             ORDER BY p.client_id = ?2 DESC, p.name_key LIMIT 300`,
          )
          .bind(JSON.stringify(typedKeys), owner?.id ?? '')
          .all<{ id: number; name: string; name_key: string; client_id: string | null; client_name: string | null }>()
      ).results
    : []

  const groups = new Map<string, NameGroup>()
  for (const row of rows) {
    const key = groupKey(row, listed)
    let group = groups.get(key)
    if (!group) {
      const personId = key.startsWith('p') ? Number(key.slice(1)) : null
      const listedAs = listed.find((l) => l.person_id === personId)
      const person = personId !== null ? { id: personId, name: row.person_name ?? listedAs?.name ?? row.name } : null
      const candidates: Candidate[] = person
        ? [{ id: person.id, name: person.name, clientName: null, where: listedAs ? 'gallery' : 'client' }]
        : found
            .filter((f) => f.name_key === row.name_key || nameKey(defaultLabel(f.name)) === row.name_key)
            .map((f) => ({
              id: f.id,
              name: f.name,
              clientName: f.client_id && f.client_id !== owner?.id ? f.client_name : null,
              where: listed.some((l) => l.person_id === f.id) ? ('gallery' as const) : owner && f.client_id === owner.id ? ('client' as const) : ('archive' as const),
            }))
            .sort((a, b) => ORDER[a.where] - ORDER[b.where])
            .slice(0, 8)
      group = { key, name: row.name, person, candidates, chosen: candidates.find((c) => c.where !== 'archive')?.id ?? null, photos: [] }
      groups.set(key, group)
    }
    let photo = group.photos.find((p) => p.assetId === row.asset_id)
    if (!photo) {
      const names = onPhoto.get(row.asset_id) ?? []
      photo = { assetId: row.asset_id, filename: row.filename, by: [], names: names.map((n) => n.name), alreadyTagged: group.person !== null && names.some((n) => n.id === group!.person!.id), suggestionIds: [] }
      group.photos.push(photo)
    }
    if (!photo.by.includes(row.by_name)) photo.by.push(row.by_name)
    photo.suggestionIds.push(row.id)
  }
  return { groups: [...groups.values()].sort((a, b) => b.photos.length - a.photos.length || a.name.localeCompare(b.name)), count: rows.length }
}

const ORDER = { gallery: 0, client: 1, archive: 2 } as const

export interface DecideInput {
  keys: string[]
  ids: number[]
}

export function parseDecision(body: Record<string, unknown>): DecideInput {
  const keys = body.keys
  const ids = body.suggestionIds
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 100 || !keys.every((k) => typeof k === 'string' && k.length <= 200)) {
    throw new BadRequest('keys must be the groups decided.')
  }
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_DECIDE || !ids.every((i) => Number.isInteger(i) && i > 0)) {
    throw new BadRequest(`suggestionIds is a list of up to ${MAX_DECIDE}.`)
  }
  return { keys: keys as string[], ids: [...new Set(ids as number[])] }
}

/** The ids still live, waiting, and in one of the groups decided; the rest were taken back or changed meanwhile. */
async function stillThere(db: D1Database, share: Pick<ShareRow, 'id' | 'album_id'>, input: DecideInput): Promise<LiveRow[]> {
  const [rowsResult, listedResult] = await db.batch([liveRows(db, share, input.ids), listedPeople(db, share)])
  const listed = listedResult!.results as unknown as Listed[]
  const keys = new Set(input.keys)
  return (rowsResult!.results as unknown as LiveRow[]).filter((r) => keys.has(groupKey(r, listed)))
}

/** Delete what isn't live any more on this gallery (`?1` album, `?2` limit, `?3` gallery). */
const purgeGallery = (db: D1Database, share: Pick<ShareRow, 'id' | 'album_id'>) =>
  db
    .prepare(`WITH ${SHOWN} DELETE FROM name_suggestions WHERE share_id = ?3 AND id NOT IN (SELECT ns.id FROM name_suggestions ns WHERE ${LIVE})`)
    .bind(share.album_id, MAX_GALLERY_ITEMS, share.id)

export interface AcceptInput extends DecideInput {
  personId: number | null
  newName: string | null
  isChild: boolean
  listInGallery: boolean
}

export function parseAccept(body: Record<string, unknown>): AcceptInput {
  const decision = parseDecision(body)
  const personId = Number.isInteger(body.personId) && (body.personId as number) > 0 ? (body.personId as number) : null
  const newName = personId === null ? cleanName(body.newName, 120) : null
  return { ...decision, personId, newName, isChild: body.isChild === true, listInGallery: body.listInGallery === true }
}

export type AcceptOutcome =
  | { accepted: number; skipped: number; person: { id: number; name: string; created: boolean }; listed: boolean }
  | { error: 'name_taken'; person: { id: number; name: string; clientName: string | null } }
  | { error: 'no_person' }

/**
 * Tag the photos of the suggestions decided with a person (existing, or new and linked to the gallery's client),
 * then delete them. A new name another person already has is refused, never merged into them.
 */
export async function acceptNames(db: D1Database, share: Pick<ShareRow, 'id' | 'album_id'>, input: AcceptInput, actorId: string): Promise<AcceptOutcome> {
  const rows = await stillThere(db, share, input)
  const skipped = input.ids.length - rows.length
  const now = nowIso()
  let person: { id: number; name: string; created: boolean }
  if (input.personId !== null) {
    const found = await db.prepare('SELECT id, name FROM people WHERE id = ?').bind(input.personId).first<{ id: number; name: string }>()
    if (!found) return { error: 'no_person' }
    person = { ...found, created: false }
  } else {
    if (rows.length === 0) return { accepted: 0, skipped, person: { id: 0, name: input.newName!, created: false }, listed: false }
    const made = await db
      .prepare(
        `INSERT INTO people (name, name_key, client_id, created_by, created_at, updated_at) VALUES (?1, ?2, ${CLIENT_OF_ALBUM.replace('?1', '?3')}, ?4, ?5, ?5)
         ON CONFLICT (name_key) DO NOTHING RETURNING id`,
      )
      .bind(input.newName!, fold(input.newName!), share.album_id, actorId, now)
      .first<{ id: number }>()
    if (!made) {
      const other = await db
        .prepare('SELECT p.id, p.name, c.name AS client_name FROM people p LEFT JOIN clients c ON c.id = p.client_id WHERE p.name_key = ?')
        .bind(fold(input.newName!))
        .first<{ id: number; name: string; client_name: string | null }>()
      return { error: 'name_taken', person: { id: other!.id, name: other!.name, clientName: other!.client_name } }
    }
    person = { id: made.id, name: input.newName!, created: true }
  }
  if (rows.length === 0) return { accepted: 0, skipped, person, listed: false }

  const ids = JSON.stringify(rows.map((r) => r.id))
  const photos = `SELECT asset_id FROM name_suggestions WHERE share_id = ?2 AND id IN (SELECT value FROM json_each(?1))`
  const results = await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO asset_people (asset_id, person_id, how, created_at) SELECT DISTINCT asset_id, ?3, 'client', ?4 FROM (${photos})`)
      .bind(ids, share.id, person.id, now),
    // Searched again with the name, and a "no people" count becomes one (as catalog/people.ts tagPeople does).
    db.prepare(`UPDATE assets SET indexed_at = NULL WHERE id IN (${photos})`).bind(ids, share.id),
    db.prepare(`UPDATE assets SET facet_people = 'one' WHERE id IN (${photos}) AND facet_people = 'none' AND facet_people_by IS NULL`).bind(ids, share.id),
    ...(input.isChild ? [db.prepare('UPDATE people SET is_child = 1, updated_at = ? WHERE id = ?').bind(now, person.id)] : []),
    ...(input.listInGallery
      ? [
          db
            .prepare(
              `INSERT OR IGNORE INTO share_people (share_id, person_id, group_id, label, position)
               SELECT ?1, ?2, NULL, ?3, (SELECT COALESCE(MAX(position) + 1, 0) FROM share_people WHERE share_id = ?1)
               WHERE (SELECT COUNT(*) FROM share_people WHERE share_id = ?1) < ${MAX_ENTRIES}`,
            )
            .bind(share.id, person.id, defaultLabel(person.name)),
        ]
      : []),
    db.prepare('DELETE FROM name_suggestions WHERE share_id = ?2 AND id IN (SELECT value FROM json_each(?1)) RETURNING id').bind(ids, share.id),
    purgeGallery(db, share),
  ])
  const deleted = results[results.length - 2]!.results.length
  const listed = input.listInGallery ? (results[results.length - 3]!.meta.changes ?? 0) > 0 : false
  return { accepted: deleted, skipped: input.ids.length - deleted, person, listed }
}

/** Drop the suggestions decided. */
export async function rejectNames(db: D1Database, share: Pick<ShareRow, 'id' | 'album_id'>, input: DecideInput): Promise<{ rejected: number; skipped: number }> {
  const rows = await stillThere(db, share, input)
  if (rows.length === 0) return { rejected: 0, skipped: input.ids.length }
  const [gone] = await db.batch([
    db.prepare('DELETE FROM name_suggestions WHERE share_id = ?2 AND id IN (SELECT value FROM json_each(?1)) RETURNING id').bind(JSON.stringify(rows.map((r) => r.id)), share.id),
    purgeGallery(db, share),
  ])
  return { rejected: gone!.results.length, skipped: input.ids.length - gone!.results.length }
}

// ---- Counts and tidying ----

/** Waiting names per gallery, for the gallery list. One query. */
export async function waitingCounts(db: D1Database): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(`SELECT ns.share_id, COUNT(*) AS n FROM name_suggestions ns WHERE ${LIVE_ANYWHERE} GROUP BY ns.share_id`)
    .all<{ share_id: string; n: number }>()
  return new Map(results.map((r) => [r.share_id, r.n]))
}

/** Waiting names on one gallery, exactly as Names to check counts them. */
export async function waitingCount(db: D1Database, share: Pick<ShareRow, 'id' | 'album_id'>): Promise<number> {
  const row = await db
    .prepare(`WITH ${SHOWN} SELECT COUNT(*) AS n FROM name_suggestions ns WHERE ${LIVE}`)
    .bind(share.album_id, MAX_GALLERY_ITEMS, share.id)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/** The sweep's tidy-up: suggestions that can't be live any more, a few hundred at a time. One query. */
export async function purgeStale(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare(`DELETE FROM name_suggestions WHERE id IN (SELECT ns.id FROM name_suggestions ns WHERE NOT (${LIVE_ANYWHERE}) LIMIT 500) RETURNING id`)
    .all()
  return results.length
}

/**
 * At most once an hour per gallery: whether to note new suggestions (Activity, and email to the photographer), and
 * how many arrived since the last note. Null: noted within the hour.
 */
export async function claimNote(db: D1Database, share: Pick<ShareRow, 'id' | 'suggestions_noted_at'>): Promise<number | null> {
  const now = new Date()
  const cutoff = new Date(now.getTime() - 60 * 60_000).toISOString()
  const claimed = await db
    .prepare('UPDATE shares SET suggestions_noted_at = ? WHERE id = ? AND (suggestions_noted_at IS NULL OR suggestions_noted_at < ?) RETURNING id')
    .bind(now.toISOString(), share.id, cutoff)
    .first()
  if (!claimed) return null
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM name_suggestions WHERE share_id = ? AND (? IS NULL OR created_at > ?)')
    .bind(share.id, share.suggestions_noted_at, share.suggestions_noted_at)
    .first<{ n: number }>()
  return row?.n ?? 0
}
