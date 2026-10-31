/**
 * People named by hand (plans/PLAN-FN-v2.md FN1 in cf-dam-docs): a person is a name the photographer gives, and photos
 * are tagged with people like they are with keywords. Names already in files (XMP PersonInImage, MWG face region
 * names, as Lightroom writes them) are tagged the same way, marked 'file'. Nothing biometric: no faces, no matching.
 *
 * Names never reach clients: not in client galleries, not in their views. Activity names nobody.
 */
import { BadRequest } from '../lib/http'
import { nowIso } from '../lib/time'
import { fold } from '../lib/fold'
import { markUnindexed } from './search'

export interface PersonJson {
  id: number
  name: string
  notes: string
  clientId: string | null
  isChild: boolean
  /** Never shown to any client, in any gallery (catalog/gallery-people.ts). */
  hiddenFromClients: boolean
  /** Photos tagged with them (not in the trash). */
  photos: number
  /** A photo of them to show beside the name. */
  coverId: string | null
  createdAt: string
}

interface PersonRow {
  id: number
  name: string
  notes: string
  client_id: string | null
  is_child: number
  hidden_from_clients: number
  created_at: string
  photos: number
  cover: string | null
}

const toJson = (r: PersonRow): PersonJson => ({
  id: r.id,
  name: r.name,
  notes: r.notes,
  clientId: r.client_id,
  isChild: r.is_child === 1,
  hiddenFromClients: r.hidden_from_clients === 1,
  photos: r.photos,
  coverId: r.cover,
  createdAt: r.created_at,
})

const SELECT = `SELECT p.id, p.name, p.notes, p.client_id, p.is_child, p.hidden_from_clients, p.created_at,
  (SELECT COUNT(*) FROM asset_people ap JOIN assets a ON a.id = ap.asset_id AND a.deleted_at IS NULL WHERE ap.person_id = p.id) AS photos,
  (SELECT ap.asset_id FROM asset_people ap JOIN assets a ON a.id = ap.asset_id AND a.deleted_at IS NULL WHERE ap.person_id = p.id ORDER BY a.captured_at DESC LIMIT 1) AS cover
  FROM people p`

/** Everyone, A to Z; `q` finds names without minding accents. */
export async function listPeople(db: D1Database, q = ''): Promise<PersonJson[]> {
  const key = fold(q.trim())
  const { results } = key
    ? await db.prepare(`${SELECT} WHERE p.name_key LIKE ? ESCAPE '\\' ORDER BY p.name_key LIMIT 500`).bind(`%${key.replace(/[\\%_]/g, (m) => `\\${m}`)}%`).all<PersonRow>()
    : await db.prepare(`${SELECT} ORDER BY p.name_key LIMIT 2000`).all<PersonRow>()
  return results.map(toJson)
}

/** How many people are linked to a client (offered for deleting when the client is erased). */
export async function clientNamedPeople(db: D1Database, clientId: string): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM people WHERE client_id = ?').bind(clientId).first<{ n: number }>())?.n ?? 0
}

export async function getPerson(db: D1Database, id: number): Promise<PersonJson | null> {
  const row = await db.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<PersonRow>()
  return row ? toJson(row) : null
}

const cleanName = (value: unknown): string => {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!name || name.length > 120) throw new BadRequest('A name of up to 120 characters.')
  return name
}

/** The person with this name (however it's typed), made if there's none. */
export async function personByName(db: D1Database, rawName: string, actorId: string | null): Promise<{ id: number; created: boolean }> {
  const name = cleanName(rawName)
  const now = nowIso()
  const made = await db
    .prepare('INSERT INTO people (name, name_key, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (name_key) DO NOTHING RETURNING id')
    .bind(name, fold(name), actorId, now, now)
    .first<{ id: number }>()
  if (made) return { id: made.id, created: true }
  const found = await db.prepare('SELECT id FROM people WHERE name_key = ?').bind(fold(name)).first<{ id: number }>()
  return { id: found!.id, created: false }
}

/** Ids for names read from files (keyed by `fold(name)`), making the people that don't exist yet. Two round trips. */
export async function resolvePeople(db: D1Database, names: string[]): Promise<Map<string, number>> {
  const wanted = new Map<string, string>()
  for (const raw of names) {
    const name = raw.replace(/\s+/g, ' ').trim().slice(0, 120)
    if (name) wanted.set(fold(name), name)
  }
  if (wanted.size === 0) return new Map()
  const now = nowIso()
  const rows = [...wanted].map(([key, name]) => ({ key, name }))
  const [, found] = await db.batch([
    db
      .prepare(
        `INSERT INTO people (name, name_key, created_at, updated_at)
         SELECT json_extract(j.value, '$.name'), json_extract(j.value, '$.key'), ?1, ?1 FROM json_each(?2) j WHERE true
         ON CONFLICT (name_key) DO NOTHING`,
      )
      .bind(now, JSON.stringify(rows)),
    db.prepare('SELECT id, name_key FROM people WHERE name_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...wanted.keys()])),
  ])
  return new Map((found!.results as { id: number; name_key: string }[]).map((r) => [r.name_key, r.id]))
}

export interface PersonPatch {
  name?: string
  notes?: string
  clientId?: string | null
  isChild?: boolean
  hiddenFromClients?: boolean
}

export function parsePersonPatch(body: Record<string, unknown>): PersonPatch {
  const patch: PersonPatch = {}
  if (body.name !== undefined) patch.name = cleanName(body.name)
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string' || body.notes.length > 5000) throw new BadRequest('notes is text of up to 5,000 characters.')
    patch.notes = body.notes
  }
  if (body.clientId !== undefined) patch.clientId = typeof body.clientId === 'string' && body.clientId ? body.clientId.slice(0, 64) : null
  if (body.isChild !== undefined) patch.isChild = body.isChild === true
  if (body.hiddenFromClients !== undefined) patch.hiddenFromClients = body.hiddenFromClients === true
  return patch
}

/** Change a person. Renaming to a name someone else has is refused (merge them instead). Null: no such person. */
export async function updatePerson(db: D1Database, id: number, patch: PersonPatch): Promise<'ok' | 'taken' | null> {
  const sets: string[] = []
  const binds: unknown[] = []
  if (patch.name !== undefined) {
    const other = await db.prepare('SELECT id FROM people WHERE name_key = ? AND id != ?').bind(fold(patch.name), id).first()
    if (other) return 'taken'
    sets.push('name = ?', 'name_key = ?')
    binds.push(patch.name, fold(patch.name))
  }
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`)
    binds.push(value)
  }
  if (patch.notes !== undefined) set('notes', patch.notes)
  if (patch.clientId !== undefined) set('client_id', patch.clientId)
  if (patch.isChild !== undefined) set('is_child', patch.isChild ? 1 : 0)
  if (patch.hiddenFromClients !== undefined) set('hidden_from_clients', patch.hiddenFromClients ? 1 : 0)
  const result = await db
    .prepare(`UPDATE people SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`)
    .bind(...binds, nowIso(), id)
    .run()
  if (result.meta.changes !== 1) return null
  // A new name is found by search: the person's photos are indexed again by the sweep.
  if (patch.name !== undefined) await reindexPerson(db, id)
  return 'ok'
}

async function reindexPerson(db: D1Database, id: number): Promise<void> {
  const { results } = await db.prepare('SELECT asset_id FROM asset_people WHERE person_id = ?').bind(id).all<{ asset_id: string }>()
  await markUnindexed(db, results.map((r) => r.asset_id))
}

/** Delete a person and every tag of them (trashed photos too). Returns how many photos lost the tag, or null. */
export async function deletePerson(db: D1Database, id: number): Promise<number | null> {
  const { results } = await db.prepare('SELECT asset_id FROM asset_people WHERE person_id = ?').bind(id).all<{ asset_id: string }>()
  // RETURNING, not meta.changes: D1 counts the tags the cascade removes too.
  const gone = await db.prepare('DELETE FROM people WHERE id = ? RETURNING id').bind(id).first()
  if (!gone) return null
  await markUnindexed(db, results.map((r) => r.asset_id))
  return results.length
}

/**
 * Merge `from` into `into`: its photos become theirs, and `from` goes. They also join `from`'s groups (a group of
 * another client's too) and galleries, keeping their own name where both were listed; a child or a person never
 * shown to clients stays so. Returns photos moved, or null.
 */
export async function mergePeople(db: D1Database, from: number, into: number): Promise<number | null> {
  if (from === into) throw new BadRequest('Choose someone else to merge into.')
  const both = await db.prepare('SELECT COUNT(*) AS n FROM people WHERE id IN (?, ?)').bind(from, into).first<{ n: number }>()
  if (both?.n !== 2) return null
  const { results } = await db.prepare('SELECT asset_id FROM asset_people WHERE person_id = ?').bind(from).all<{ asset_id: string }>()
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO asset_people (asset_id, person_id, how, created_at) SELECT asset_id, ?, how, created_at FROM asset_people WHERE person_id = ?').bind(into, from),
    db.prepare('INSERT OR IGNORE INTO people_group_members (group_id, person_id) SELECT group_id, ? FROM people_group_members WHERE person_id = ?').bind(into, from),
    db.prepare('INSERT OR IGNORE INTO share_people (share_id, person_id, label, position) SELECT share_id, ?, label, position FROM share_people WHERE person_id = ?').bind(into, from),
    // Names the couple ticked for them wait for the person they're merged into.
    db.prepare('UPDATE name_suggestions SET person_id = ? WHERE person_id = ?').bind(into, from),
    db
      .prepare(
        `UPDATE people SET is_child = max(is_child, (SELECT is_child FROM people WHERE id = ?1)),
           hidden_from_clients = max(hidden_from_clients, (SELECT hidden_from_clients FROM people WHERE id = ?1)) WHERE id = ?2`,
      )
      .bind(from, into),
    db.prepare('DELETE FROM people WHERE id = ?').bind(from),
  ])
  await markUnindexed(db, results.map((r) => r.asset_id))
  return results.length
}

/** Tag (or untag) photos with a person. Returns how many photos changed. */
export async function tagPeople(db: D1Database, assetIds: string[], personId: number, add: boolean): Promise<number> {
  if (assetIds.length === 0) return 0
  const ids = JSON.stringify([...new Set(assetIds)])
  const result = add
    ? await db
        .prepare("INSERT OR IGNORE INTO asset_people (asset_id, person_id, how, created_at) SELECT a.id, ?, 'hand', ? FROM assets a WHERE a.id IN (SELECT value FROM json_each(?))")
        .bind(personId, nowIso(), ids)
        .run()
    : await db.prepare('DELETE FROM asset_people WHERE person_id = ? AND asset_id IN (SELECT value FROM json_each(?))').bind(personId, ids).run()
  if (result.meta.changes > 0) {
    await markUnindexed(db, [...new Set(assetIds)])
    // Someone is in it after all: a "no people" count becomes one, unless a person answered it by hand.
    if (add) await db.prepare("UPDATE assets SET facet_people = 'one' WHERE id IN (SELECT value FROM json_each(?)) AND facet_people = 'none' AND facet_people_by IS NULL").bind(ids).run()
  }
  return result.meta.changes
}

/** The people tagged on one photo. */
export async function assetPeople(db: D1Database, assetId: string): Promise<{ id: number; name: string; how: string }[]> {
  const { results } = await db
    .prepare('SELECT p.id, p.name, ap.how FROM asset_people ap JOIN people p ON p.id = ap.person_id WHERE ap.asset_id = ? ORDER BY p.name_key')
    .bind(assetId)
    .all<{ id: number; name: string; how: string }>()
  return results
}
