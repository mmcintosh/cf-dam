/**
 * Making missing previews again (plans/PLAN-S-v1.md, slice S4).
 *
 * Thumbnails and previews are kept in the built-in R2 bucket, outside backups. After a restore into a
 * new Cloudflare account they are all gone; one can also go missing on its own. Three parts:
 *
 *  - Finding them: a check pass over every rendition the catalog lists, asking R2 whether it's there
 *    (`checkStep`, started after a restore or from the Storage page), and any preview found missing
 *    when someone asks for it (`noteMissing`). A missing one's row is dropped and its photo requested.
 *  - Deciding who makes them (`requestPreviews`): the photo's agent if it has one (reading the NAS costs
 *    nothing), else the Worker from an original it can read, else nobody yet: an original only in an
 *    archive class needs a restore first.
 *  - Making them: the Worker, a few at a time in the sweep (`remakeStep`); agents, when the heartbeat
 *    hands them their photos (`askAgent`) and they send those files again.
 */
import exifr from 'exifr'
import type { DamBindings } from '../env'
import { logActivity } from '../lib/activity'
import { nowIso } from '../lib/time'
import { getConnection, providerFor, renditionStore } from '../storage/connections'
import { ARCHIVE_CLASSES } from '../storage/types'
import { getAsset, getLocations, readableNow, type LocationRow } from './assets'
import { METADATA_HEAD_BYTES, RENDERABLE_TYPES } from './metadata'
import { generateRenditions, hasRendition, MAX_TRANSFORM_BYTES, storeEmbeddedThumbnail } from './renditions'

export type PreviewRoute = 'agent' | 'worker' | 'archived' | 'unreadable'

const CHECK_KEY = 'previews.check'
/** Renditions asked about per page, and at once. */
const CHECK_PAGE = 500
const HEAD_CONCURRENCY = 25
/** Photos the Worker remakes at once. */
const REMAKE_CONCURRENCY = 4
const REMAKE_RETRY_MS = 60 * 60_000
const REMAKE_ATTEMPTS = 3
/** An agent asked for a photo's previews is asked again after this, and given up on after AGENT_ATTEMPTS. */
export const AGENT_RETRY_MS = 24 * 3_600_000
const AGENT_ATTEMPTS = 5
/** Photos handed to an agent per heartbeat. */
export const AGENT_BATCH = 200

interface CheckState {
  startedAt: string
  /** The last renditions rowid checked. */
  after: number
  checked: number
  missing: number
  /** R2 had no renditions at all when the check started (a new account): every one is missing. */
  empty: boolean | null
}

const ARCHIVE_LIST = JSON.stringify([...ARCHIVE_CLASSES])

/** Decide who makes each photo's previews, and queue it. Two round trips for any number of photos. */
export async function requestPreviews(db: D1Database, assetIds: string[]): Promise<number> {
  const ids = [...new Set(assetIds)]
  if (ids.length === 0) return 0
  const { results } = await db
    .prepare(
      `SELECT a.id,
         (SELECT s.id FROM asset_locations l JOIN sources s ON s.connection_id = l.connection_id
           WHERE l.asset_id = a.id AND l.storage_class = 'NAS' AND l.state = 'present' AND s.revoked_at IS NULL LIMIT 1) AS source_id,
         EXISTS (SELECT 1 FROM asset_locations l WHERE l.asset_id = a.id AND l.storage_class != 'NAS'
           AND ((l.state = 'present' AND l.storage_class NOT IN (SELECT value FROM json_each(?2))) OR l.state = 'restored')) AS readable,
         EXISTS (SELECT 1 FROM asset_locations l WHERE l.asset_id = a.id AND l.storage_class IN (SELECT value FROM json_each(?2))) AS archived
       FROM assets a WHERE a.id IN (SELECT value FROM json_each(?1)) AND a.deleted_at IS NULL`,
    )
    .bind(JSON.stringify(ids), ARCHIVE_LIST)
    .all<{ id: string; source_id: string | null; readable: number; archived: number }>()
  const rows = results.map((r) => {
    const route: PreviewRoute = r.source_id ? 'agent' : r.readable ? 'worker' : r.archived ? 'archived' : 'unreadable'
    const error =
      route === 'archived'
        ? 'The original is only in an archive class: restore it, and its previews are made then.'
        : route === 'unreadable'
          ? 'No copy of the original is where cf-dam or an agent can read it.'
          : null
    return [r.id, route, r.source_id, error]
  })
  if (rows.length === 0) return 0
  await db
    .prepare(
      `INSERT INTO preview_requests (asset_id, route, source_id, requested_at, error)
       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), ?, json_extract(value, '$[3]') FROM json_each(?)
       -- WHERE true: SQLite needs it to read ON CONFLICT after a SELECT as the upsert.
       WHERE true
       ON CONFLICT (asset_id) DO UPDATE SET route = excluded.route, source_id = excluded.source_id, requested_at = excluded.requested_at,
         asked_at = NULL, attempts = 0, error = excluded.error`,
    )
    .bind(nowIso(), JSON.stringify(rows))
    .run()
  return rows.length
}

/** A rendition someone asked for wasn't in R2: forget it, and have the photo's previews made again. */
export async function noteMissing(db: D1Database, assetId: string, name: string): Promise<void> {
  const gone = await db.prepare('DELETE FROM renditions WHERE asset_id = ? AND name = ? RETURNING asset_id').bind(assetId, name).first()
  if (gone) await requestPreviews(db, [assetId])
}

/** Start a check of every rendition (unless one is running). */
export async function startPreviewCheck(db: D1Database): Promise<boolean> {
  const state: CheckState = { startedAt: nowIso(), after: 0, checked: 0, missing: 0, empty: null }
  const result = await db
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING')
    .bind(CHECK_KEY, JSON.stringify(state), state.startedAt)
    .run()
  return result.meta.changes === 1
}

async function inParallel<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!)
      }
    }),
  )
  return out
}

/** The sweep's check: a page of renditions at a time while `more` allows. Returns whether one is running. */
export async function checkStep(env: DamBindings, more: () => boolean): Promise<boolean> {
  const db = env.DB
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(CHECK_KEY).first<{ value: string }>()
  if (!row) return false
  const state = JSON.parse(row.value) as CheckState
  const store = renditionStore(env)
  if (state.empty === null) state.empty = (await store.list('renditions/')).objects.length === 0

  while (more()) {
    const { results } = await db
      .prepare('SELECT rowid AS r, asset_id, key FROM renditions WHERE rowid > ? ORDER BY rowid LIMIT ?')
      .bind(state.after, CHECK_PAGE)
      .all<{ r: number; asset_id: string; key: string }>()
    if (results.length === 0) {
      await db.prepare('DELETE FROM settings WHERE key = ?').bind(CHECK_KEY).run()
      await logActivity(db, { userId: null, action: 'previews.checked', details: { checked: state.checked, missing: state.missing } })
      return false
    }
    const there = state.empty ? results.map(() => false) : await inParallel(results, HEAD_CONCURRENCY, async (r) => (await store.head(r.key)) !== null)
    const missing = results.filter((_, i) => !there[i])
    if (missing.length > 0) {
      await db.prepare('DELETE FROM renditions WHERE rowid IN (SELECT value FROM json_each(?))').bind(JSON.stringify(missing.map((m) => m.r))).run()
      await requestPreviews(db, missing.map((m) => m.asset_id))
    }
    state.after = results.at(-1)!.r
    state.checked += results.length
    state.missing += missing.length
    await db.prepare('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?').bind(JSON.stringify(state), nowIso(), CHECK_KEY).run()
  }
  return true
}

/** A location the Worker can read the original from: the built-in R2 first (no egress), not archived. */
export function readableLocation(locations: LocationRow[]): LocationRow | null {
  const usable = locations.filter((l) => l.storage_class !== 'NAS' && readableNow(l))
  return usable.find((l) => l.connection_id === 'r2') ?? usable[0] ?? null
}

const giveUp = (db: D1Database, assetId: string, route: PreviewRoute, error: string) =>
  db.prepare('UPDATE preview_requests SET route = ?, error = ? WHERE asset_id = ?').bind(route, error.slice(0, 500), assetId).run()

/** Make one photo's previews from its original. */
async function remake(env: DamBindings, assetId: string, attempts: number): Promise<boolean> {
  const db = env.DB
  try {
    const asset = await getAsset(db, assetId)
    if (!asset) return false
    const location = readableLocation(await getLocations(db, assetId))
    const connection = location && (await getConnection(db, location.connection_id))
    if (!location || !connection) {
      // Moved since it was requested: decide again.
      await requestPreviews(db, [assetId])
      return false
    }
    const provider = providerFor(env, connection)
    if (RENDERABLE_TYPES.has(asset.mime_type) && asset.size <= MAX_TRANSFORM_BYTES) {
      const original = await provider.get(location.key)
      if (!original) throw new Error('The original isn’t where the catalog says.')
      await generateRenditions(env, assetId, original.body)
    } else {
      // RAW and other formats Images can't decode: the small JPEG many carry, for a thumbnail.
      const head = await provider.get(location.key, { offset: 0, length: Math.min(METADATA_HEAD_BYTES, Math.max(asset.size, 1)) })
      const bytes = head ? new Uint8Array(await new Response(head.body).arrayBuffer()) : null
      const embedded = bytes ? await exifr.thumbnail(bytes).catch(() => undefined) : undefined
      if (!embedded || !(await storeEmbeddedThumbnail(env, assetId, embedded))) {
        await giveUp(db, assetId, 'unreadable', 'cf-dam can’t make a preview of this kind of file itself (the browser or an agent made it when it was added). Upload it again to make one.')
        return false
      }
    }
    if (!(await hasRendition(db, assetId, 'thumb'))) throw new Error('No thumbnail came of it.')
    await db.prepare('DELETE FROM preview_requests WHERE asset_id = ?').bind(assetId).run()
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[previews] could not remake', assetId, message)
    if (attempts >= REMAKE_ATTEMPTS) await giveUp(db, assetId, 'unreadable', `Making its previews failed ${REMAKE_ATTEMPTS} times: ${message}`)
    else await db.prepare('UPDATE preview_requests SET error = ? WHERE asset_id = ?').bind(message.slice(0, 500), assetId).run()
    return false
  }
}

/**
 * The sweep's remaking: the Worker's share, a few at a time while `more` allows; and tidying the agents'
 * share (done once both previews are in; given up on after several asks). Returns how many were made.
 */
export async function remakeStep(env: DamBindings, more: () => boolean): Promise<number> {
  const db = env.DB
  const now = Date.now()
  await db.batch([
    db.prepare(
      `DELETE FROM preview_requests WHERE route = 'agent' AND asked_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM renditions r WHERE r.asset_id = preview_requests.asset_id AND r.name = 'thumb')
         AND EXISTS (SELECT 1 FROM renditions r WHERE r.asset_id = preview_requests.asset_id AND r.name = 'preview')`,
    ),
    db
      .prepare("UPDATE preview_requests SET route = 'unreadable', error = ? WHERE route = 'agent' AND attempts >= ? AND asked_at < ?")
      .bind(`Its agent was asked ${AGENT_ATTEMPTS} times and sent nothing.`, AGENT_ATTEMPTS, new Date(now - AGENT_RETRY_MS).toISOString()),
  ])
  let made = 0
  while (more()) {
    const { results: claimed } = await db
      .prepare(
        `UPDATE preview_requests SET asked_at = ?, attempts = attempts + 1
         WHERE asset_id IN (SELECT asset_id FROM preview_requests WHERE route = 'worker' AND (asked_at IS NULL OR asked_at < ?) ORDER BY requested_at LIMIT ?)
         RETURNING asset_id, attempts`,
      )
      .bind(nowIso(), new Date(now - REMAKE_RETRY_MS).toISOString(), REMAKE_CONCURRENCY)
      .all<{ asset_id: string; attempts: number }>()
    if (claimed.length === 0) break
    const outcomes = await Promise.all(claimed.map((c) => remake(env, c.asset_id, c.attempts)))
    made += outcomes.filter(Boolean).length
  }
  return made
}

/** For an agent's heartbeat: the photos it should send again (marked as asked). One statement. */
export function askAgent(db: D1Database, sourceId: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE preview_requests SET asked_at = ?, attempts = attempts + 1
       WHERE asset_id IN (SELECT asset_id FROM preview_requests WHERE source_id = ? AND route = 'agent' AND attempts < ? AND (asked_at IS NULL OR asked_at < ?) LIMIT ?)
       RETURNING asset_id`,
    )
    .bind(nowIso(), sourceId, AGENT_ATTEMPTS, new Date(Date.now() - AGENT_RETRY_MS).toISOString(), AGENT_BATCH)
}

export interface PreviewStatus {
  check: CheckState | null
  waiting: Record<PreviewRoute, number>
  /** A few that can't be made yet, with why. */
  stuck: { assetId: string; filename: string; route: PreviewRoute; error: string | null }[]
}

export async function previewStatus(db: D1Database): Promise<PreviewStatus> {
  const [check, counts, stuck] = await db.batch([
    db.prepare('SELECT value FROM settings WHERE key = ?').bind(CHECK_KEY),
    db.prepare('SELECT route, COUNT(*) AS n FROM preview_requests GROUP BY route'),
    db.prepare(
      `SELECT p.asset_id, a.filename, p.route, p.error FROM preview_requests p JOIN assets a ON a.id = p.asset_id
       WHERE p.route IN ('archived', 'unreadable') ORDER BY p.requested_at DESC LIMIT 50`,
    ),
  ])
  const waiting: Record<PreviewRoute, number> = { agent: 0, worker: 0, archived: 0, unreadable: 0 }
  for (const r of counts!.results as { route: PreviewRoute; n: number }[]) waiting[r.route] = r.n
  const value = (check!.results[0] as { value: string } | undefined)?.value
  return {
    check: value ? (JSON.parse(value) as CheckState) : null,
    waiting,
    stuck: (stuck!.results as { asset_id: string; filename: string; route: PreviewRoute; error: string | null }[]).map((r) => ({
      assetId: r.asset_id,
      filename: r.filename,
      route: r.route,
      error: r.error,
    })),
  }
}
