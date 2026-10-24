/**
 * Where a job's originals are, and restoring a whole job (plans/PLAN-C4-v2.md, C4a). Two questions, kept apart:
 * can each original be read now, and does it have a cold backup. With the R2 copy kept when archiving, "archived"
 * doesn't mean "unreadable".
 *
 * Readable now: a copy there in a warm class (R2, a NAS, S3 Standard…), or restored and not expired (assets.ts
 * readableNow). Offerable to clients: the same, not counting a NAS (gallery downloads never read from one). Needs a
 * restore: nothing readable, but a cold copy (Glacier Flexible, Deep Archive).
 *
 * A job restore asks S3 for every photo that needs one, a few at a time through the work queue (work.ts, kind
 * 'restore'); the sweep's restore check notices when each is ready.
 */
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { getConnection, providerFor } from '../storage/connections'
import { ARCHIVE_CLASSES, type RestoreTier } from '../storage/types'
import type { DamBindings } from '../env'
import { readableNow } from './assets'

const COLD = JSON.stringify([...ARCHIVE_CLASSES])
/** A restore item is given up after this many failed asks. */
const MAX_ATTEMPTS = 3
/** How long until a restore that isn't ready is looked at (the sweep's restore check). */
const RESTORE_CHECK_MS = 20 * 60_000

export interface JobStorage {
  photos: number
  /** Can be read now, from any copy. */
  readable: number
  /** Can be read now from a copy client galleries can use (not a NAS). */
  offerable: number
  /** Readable only from a NAS: can't be offered as originals in a client gallery. */
  nasOnly: number
  /** Nothing readable now, but a cold copy exists. */
  needsRestore: number
  /** Of those, being restored now. */
  restoring: number
  /** Size of the cold copies of the photos that need a restore. */
  restoreBytes: number
  /** Have a copy in Glacier Flexible or Deep Archive. */
  coldBackup: number
}

const empty = (): JobStorage => ({ photos: 0, readable: 0, offerable: 0, nasOnly: 0, needsRestore: 0, restoring: 0, restoreBytes: 0, coldBackup: 0 })

/** One grouped query over the photos in the given scope (jobs, or one album). */
async function storageBy(db: D1Database, photos: string, binds: unknown[]): Promise<Map<string, JobStorage>> {
  const readable = `l.state NOT IN ('pending', 'gone') AND (l.storage_class NOT IN (SELECT value FROM json_each(?2)) OR (l.state = 'restored' AND l.restore_expires_at > ?1))`
  const cold = `l.state NOT IN ('pending', 'gone') AND l.storage_class IN (SELECT value FROM json_each(?2))`
  const { results } = await db
    .prepare(
      `WITH photos AS (${photos}),
       per AS (
         SELECT p.scope, p.asset_id,
           MAX(CASE WHEN ${readable} THEN 1 ELSE 0 END) AS readable,
           MAX(CASE WHEN c.provider != 'nas' AND ${readable} THEN 1 ELSE 0 END) AS offerable,
           MAX(CASE WHEN ${cold} THEN 1 ELSE 0 END) AS cold,
           MAX(CASE WHEN ${cold} THEN l.size END) AS cold_size,
           MAX(CASE WHEN l.state = 'restoring' THEN 1 ELSE 0 END) AS restoring
         FROM photos p LEFT JOIN asset_locations l ON l.asset_id = p.asset_id LEFT JOIN storage_connections c ON c.id = l.connection_id
         GROUP BY p.scope, p.asset_id)
       SELECT scope, COUNT(*) AS photos, SUM(readable) AS readable, SUM(offerable) AS offerable, SUM(cold) AS cold,
         SUM(CASE WHEN readable = 1 AND offerable = 0 THEN 1 ELSE 0 END) AS nas_only,
         SUM(CASE WHEN readable = 0 AND cold = 1 THEN 1 ELSE 0 END) AS needs_restore,
         SUM(CASE WHEN readable = 0 AND cold = 1 AND restoring = 1 THEN 1 ELSE 0 END) AS restoring,
         SUM(CASE WHEN readable = 0 AND cold = 1 THEN COALESCE(cold_size, 0) ELSE 0 END) AS restore_bytes
       FROM per GROUP BY scope`,
    )
    .bind(nowIso(), COLD, ...binds)
    .all<{ scope: string; photos: number; readable: number; offerable: number; cold: number; nas_only: number; needs_restore: number; restoring: number; restore_bytes: number }>()
  return new Map(
    results.map((r) => [
      r.scope,
      { photos: r.photos, readable: r.readable, offerable: r.offerable, nasOnly: r.nas_only, needsRestore: r.needs_restore, restoring: r.restoring, restoreBytes: r.restore_bytes, coldBackup: r.cold },
    ]),
  )
}

/** Storage for each of these jobs (one query, for the Jobs list and a job's page). */
export async function jobStorage(db: D1Database, jobIds: string[]): Promise<Map<string, JobStorage>> {
  if (jobIds.length === 0) return new Map()
  const found = await storageBy(
    db,
    `SELECT DISTINCT al.job_id AS scope, ai.asset_id FROM albums al JOIN album_items ai ON ai.album_id = al.id
     JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL WHERE al.job_id IN (SELECT value FROM json_each(?3))`,
    [JSON.stringify(jobIds)],
  )
  return new Map(jobIds.map((id) => [id, found.get(id) ?? empty()]))
}

/** Storage for one album's photos: the gallery form warns when originals are offered and some can't be. */
export async function albumStorage(db: D1Database, albumId: string): Promise<JobStorage> {
  const found = await storageBy(
    db,
    `SELECT ai.album_id AS scope, ai.asset_id FROM album_items ai JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL WHERE ai.album_id = ?3`,
    [albumId],
  )
  return found.get(albumId) ?? empty()
}

/**
 * AWS list prices (us-east-1, checked 2026-10-23), per GB and per 1,000 requests, and how long each takes. The
 * restored copies are billed as S3 Standard while they last; downloading them to clients is S3 data transfer out.
 */
export const RESTORE_PRICES = {
  DEEP_ARCHIVE: { Bulk: { gb: 0.0025, thousand: 0.025, hours: [12, 48] }, Standard: { gb: 0.02, thousand: 0.1, hours: [6, 12] } },
  GLACIER: { Bulk: { gb: 0, thousand: 0.025, hours: [5, 12] }, Standard: { gb: 0.01, thousand: 0.05, hours: [3, 5] } },
} as const
const STANDARD_GB_MONTH = 0.023
const DOWNLOAD_GB = 0.09
export const JOB_RESTORE_TIERS = ['Bulk', 'Standard'] as const
export type JobRestoreTier = (typeof JOB_RESTORE_TIERS)[number]

interface ColdItem {
  asset_id: string
  connection_id: string
  key: string
  storage_class: 'GLACIER' | 'DEEP_ARCHIVE'
  size: number | null
}

/** The cold copy to restore for each photo of the job that needs one and isn't being restored already. */
async function coldItems(db: D1Database, jobId: string): Promise<ColdItem[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT ai.asset_id FROM albums al JOIN album_items ai ON ai.album_id = al.id
       JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL WHERE al.job_id = ?`,
    )
    .bind(jobId)
    .all<{ asset_id: string }>()
  const items: ColdItem[] = []
  const now = nowIso()
  for (let i = 0; i < results.length; i += 400) {
    const ids = JSON.stringify(results.slice(i, i + 400).map((r) => r.asset_id))
    const { results: locations } = await db
      .prepare(
        `SELECT l.asset_id, l.connection_id, l.key, l.storage_class, l.state, l.restore_expires_at, l.size, c.provider
         FROM asset_locations l JOIN storage_connections c ON c.id = l.connection_id WHERE l.asset_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(ids)
      .all<{ asset_id: string; connection_id: string; key: string; storage_class: string; state: string; restore_expires_at: string | null; size: number | null; provider: string }>()
    const byAsset = new Map<string, typeof locations>()
    for (const l of locations) byAsset.set(l.asset_id, [...(byAsset.get(l.asset_id) ?? []), l])
    for (const [, rows] of byAsset) {
      if (rows.some((l) => readableNow(l, now) || l.state === 'restoring')) continue
      const cold = rows.find((l) => l.provider === 's3' && ARCHIVE_CLASSES.has(l.storage_class) && l.state !== 'pending' && l.state !== 'gone')
      if (cold) items.push({ asset_id: cold.asset_id, connection_id: cold.connection_id, key: cold.key, storage_class: cold.storage_class as ColdItem['storage_class'], size: cold.size })
    }
  }
  return items
}

export interface RestoreEstimate {
  photos: number
  bytes: number
  /** Dollars: asking for the copies, keeping them for `days`, and downloading them all once. */
  retrieval: number
  keeping: number
  downloading: number
  hours: [number, number]
}

export async function restoreEstimate(db: D1Database, jobId: string, tier: JobRestoreTier, days: number): Promise<RestoreEstimate> {
  const items = await coldItems(db, jobId)
  let retrieval = 0
  let bytes = 0
  let hours: [number, number] = [0, 0]
  for (const item of items) {
    const price = RESTORE_PRICES[item.storage_class][tier]
    const gb = (item.size ?? 0) / 1024 ** 3
    bytes += item.size ?? 0
    retrieval += gb * price.gb + price.thousand / 1000
    hours = [Math.max(hours[0], price.hours[0]), Math.max(hours[1], price.hours[1])]
  }
  const gb = bytes / 1024 ** 3
  return { photos: items.length, bytes, retrieval, keeping: gb * STANDARD_GB_MONTH * (days / 30), downloading: gb * DOWNLOAD_GB, hours }
}

/** Ask for a job restore: returns its id and how many photos it covers (0: nothing needed one). */
export async function startJobRestore(db: D1Database, jobId: string, tier: JobRestoreTier, days: number, actorId: string): Promise<{ id: string; photos: number } | null> {
  const items = await coldItems(db, jobId)
  if (items.length === 0) return null
  const id = randomId()
  const now = nowIso()
  const bytes = items.reduce((n, i) => n + (i.size ?? 0), 0)
  await db.prepare('INSERT INTO job_restores (id, job_id, tier, days, photos, bytes, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, jobId, tier, days, items.length, bytes, actorId, now).run()
  for (let i = 0; i < items.length; i += 500) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO restore_items (restore_id, asset_id, connection_id, updated_at)
         SELECT ?, json_extract(value, '$.a'), json_extract(value, '$.c'), ? FROM json_each(?)`,
      )
      .bind(id, now, JSON.stringify(items.slice(i, i + 500).map((item) => ({ a: item.asset_id, c: item.connection_id }))))
      .run()
  }
  return { id, photos: items.length }
}

export interface JobRestoreStatus {
  id: string
  tier: string
  days: number
  createdAt: string
  photos: number
  waiting: number
  asked: number
  ready: number
  failed: number
  /** When the first restored copies expire. */
  readyUntil: string | null
}

/** The job's latest restore and how far it has got. */
export async function jobRestoreStatus(db: D1Database, jobId: string): Promise<JobRestoreStatus | null> {
  const restore = await db.prepare('SELECT * FROM job_restores WHERE job_id = ? ORDER BY created_at DESC LIMIT 1').bind(jobId).first<{ id: string; tier: string; days: number; created_at: string; photos: number }>()
  if (!restore) return null
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN i.state IN ('waiting', 'asking') THEN 1 ELSE 0 END) AS waiting,
         SUM(CASE WHEN i.state = 'asked' THEN 1 ELSE 0 END) AS asked,
         SUM(CASE WHEN i.state = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN i.state = 'asked' AND (l.storage_class NOT IN (SELECT value FROM json_each(?2)) OR (l.state = 'restored' AND l.restore_expires_at > ?3)) THEN 1 ELSE 0 END) AS ready,
         MIN(CASE WHEN l.state = 'restored' AND l.restore_expires_at > ?3 THEN l.restore_expires_at END) AS ready_until
       FROM restore_items i LEFT JOIN asset_locations l ON l.asset_id = i.asset_id AND l.connection_id = i.connection_id
       WHERE i.restore_id = ?1`,
    )
    .bind(restore.id, COLD, nowIso())
    .first<{ waiting: number | null; asked: number | null; failed: number | null; ready: number | null; ready_until: string | null }>()
  return {
    id: restore.id,
    tier: restore.tier,
    days: restore.days,
    createdAt: restore.created_at,
    photos: restore.photos,
    waiting: row?.waiting ?? 0,
    asked: row?.asked ?? 0,
    ready: row?.ready ?? 0,
    failed: row?.failed ?? 0,
    readyUntil: row?.ready_until ?? null,
  }
}

/** Work-queue step (work.ts, kind 'restore'): claim up to `limit` items and ask S3 for each. Returns how many. */
export async function askRestores(env: DamBindings, limit: number): Promise<number> {
  const db = env.DB
  const { results: claimed } = await db
    .prepare(
      `UPDATE restore_items SET state = 'asking', updated_at = ?1
       WHERE rowid IN (SELECT rowid FROM restore_items WHERE state = 'waiting' ORDER BY updated_at LIMIT ?2) AND state = 'waiting'
       RETURNING restore_id, asset_id, connection_id, attempts`,
    )
    .bind(nowIso(), limit)
    .all<{ restore_id: string; asset_id: string; connection_id: string; attempts: number }>()
  const settings = new Map<string, { tier: RestoreTier; days: number } | null>()
  for (const item of claimed) {
    const done = (state: string, error: string | null = null) =>
      db.prepare('UPDATE restore_items SET state = ?, error = ?, attempts = attempts + ?, updated_at = ? WHERE restore_id = ? AND asset_id = ?')
        .bind(state, error, error ? 1 : 0, nowIso(), item.restore_id, item.asset_id)
        .run()
    try {
      if (!settings.has(item.restore_id)) {
        settings.set(item.restore_id, await db.prepare('SELECT tier, days FROM job_restores WHERE id = ?').bind(item.restore_id).first<{ tier: RestoreTier; days: number }>())
      }
      const asked = settings.get(item.restore_id)
      const location = await db.prepare('SELECT * FROM asset_locations WHERE asset_id = ? AND connection_id = ?').bind(item.asset_id, item.connection_id).first<{ key: string; storage_class: string; state: string; restore_expires_at: string | null }>()
      const connection = await getConnection(db, item.connection_id)
      if (!asked || !location || !connection) {
        await done('failed', 'The copy or its connection is gone.')
        continue
      }
      // Readable already (restored by hand, or not cold any more), or being restored: nothing to ask.
      if (readableNow(location) || location.state === 'restoring') {
        await done('asked')
        continue
      }
      const provider = providerFor(env, connection)
      if (!provider.restore) {
        await done('failed', `${connection.name} can't restore.`)
        continue
      }
      await provider.restore(location.key, { days: asked.days, tier: asked.tier })
      await db.batch([
        db.prepare("UPDATE asset_locations SET state = 'restoring', next_check_at = ?, updated_at = ? WHERE asset_id = ? AND connection_id = ?")
          .bind(new Date(Date.now() + RESTORE_CHECK_MS).toISOString(), nowIso(), item.asset_id, item.connection_id),
        db.prepare("UPDATE restore_items SET state = 'asked', error = NULL, updated_at = ? WHERE restore_id = ? AND asset_id = ?").bind(nowIso(), item.restore_id, item.asset_id),
      ])
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300)
      await done(item.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'waiting', message).catch(() => {})
    }
  }
  return claimed.length
}

/** Sweep: items claimed by a message that never finished go back to waiting. Returns how many are waiting. */
export async function recoverRestoreItems(db: D1Database): Promise<number> {
  const stale = new Date(Date.now() - 30 * 60_000).toISOString()
  await db.prepare("UPDATE restore_items SET state = 'waiting' WHERE state = 'asking' AND updated_at < ?").bind(stale).run()
  const row = await db.prepare("SELECT COUNT(*) AS n FROM restore_items WHERE state = 'waiting'").first<{ n: number }>()
  return row?.n ?? 0
}
