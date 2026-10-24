/**
 * Archiving delivered jobs (plans/PLAN-C4-v2.md, C4b). Some days after a job is delivered (`archive.jobs` settings),
 * every photo in its albums without a cold copy gets one in S3 (Deep Archive by default). The R2 copy stays: R2 is
 * where originals are read from; S3 is the cold backup.
 *
 * - An original in R2 is **copied** by the Worker: in one checked put when small, or in 16 MiB parts, each sent with
 *   its SHA-256 so S3 refuses bytes that differ, resumable across invocations (upload id and the parts done are
 *   kept), stopped if the R2 object changes on the way, and checked for size at the end.
 * - A warm S3 copy (no R2) is **moved** to the cold class in place, unless the photo is still offered as an
 *   original in an open gallery or belongs to another job not yet finished.
 * - An original only on a NAS is never seen by cf-dam: the agent archives it if its source archives to S3, and the
 *   job says so otherwise ('blocked').
 *
 * The sweep picks due jobs and lists their items; the work queue (kind 'archive', at most 2 chains so imports and AI
 * keep moving) copies one item per step. Jobs with Keep hot are skipped.
 */
import { nowIso } from '../lib/time'
import { getConnection, providerFor } from '../storage/connections'
import { ARCHIVE_CLASSES, type CompletedPart, type StorageClass, type StorageProvider } from '../storage/types'
import type { DamBindings } from '../env'
import { logActivity } from '../lib/activity'

export const ARCHIVE_JOBS_KEY = 'archive.jobs'
export const ARCHIVE_JOB_CLASSES = ['DEEP_ARCHIVE', 'GLACIER', 'GLACIER_IR'] as const
export type ArchiveJobClass = (typeof ARCHIVE_JOB_CLASSES)[number]

export interface ArchiveJobSettings {
  enabled: boolean
  connectionId: string | null
  storageClass: ArchiveJobClass
  afterDays: number
}

export const DEFAULT_ARCHIVE_JOBS: ArchiveJobSettings = { enabled: false, connectionId: null, storageClass: 'DEEP_ARCHIVE', afterDays: 30 }

/** 16 MiB parts: small enough to hold one in memory per copy chain, large enough to be few. */
export const COPY_PART = 16 * 1024 * 1024
const MAX_PARTS = 10_000
/** A copy step stops after this long and carries on in the next message. */
const STEP_MS = 8 * 60_000
/** Progress is saved every few parts. */
const SAVE_EVERY = 4
const MAX_ATTEMPTS = 3
/** List prices (us-east-1, checked 2026-10-23): storage per GB-month and PUT requests per 1,000. */
export const ARCHIVE_PRICES: Record<ArchiveJobClass, { gbMonth: number; putThousand: number }> = {
  DEEP_ARCHIVE: { gbMonth: 0.00099, putThousand: 0.05 },
  GLACIER: { gbMonth: 0.0036, putThousand: 0.03 },
  GLACIER_IR: { gbMonth: 0.004, putThousand: 0.02 },
}

export async function getArchiveJobSettings(db: D1Database): Promise<ArchiveJobSettings> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(ARCHIVE_JOBS_KEY).first<{ value: string }>()
  try {
    return { ...DEFAULT_ARCHIVE_JOBS, ...(row ? (JSON.parse(row.value) as Partial<ArchiveJobSettings>) : {}) }
  } catch {
    return DEFAULT_ARCHIVE_JOBS
  }
}

export class ArchiveSettingsError extends Error {}

/** Check settings a person sends; returns them cleaned. The connection must be S3 and offer the class. */
export async function validArchiveJobSettings(db: D1Database, input: Record<string, unknown>): Promise<ArchiveJobSettings> {
  const s: ArchiveJobSettings = { ...(await getArchiveJobSettings(db)) }
  if (input.enabled !== undefined) s.enabled = input.enabled === true
  if (input.connectionId !== undefined) s.connectionId = typeof input.connectionId === 'string' && input.connectionId ? input.connectionId : null
  if (input.storageClass !== undefined) {
    if (!ARCHIVE_JOB_CLASSES.includes(input.storageClass as ArchiveJobClass)) throw new ArchiveSettingsError(`storageClass is one of ${ARCHIVE_JOB_CLASSES.join(', ')}.`)
    s.storageClass = input.storageClass as ArchiveJobClass
  }
  if (input.afterDays !== undefined) {
    const days = Number(input.afterDays)
    if (!Number.isInteger(days) || days < 0 || days > 3650) throw new ArchiveSettingsError('afterDays is a whole number from 0 to 3650.')
    s.afterDays = days
  }
  if (s.connectionId) {
    const connection = await getConnection(db, s.connectionId)
    if (!connection || connection.provider !== 's3') throw new ArchiveSettingsError('Archive to an S3 connection.')
    if (!connection.storageClasses.includes(s.storageClass)) throw new ArchiveSettingsError(`${connection.name} doesn't offer ${s.storageClass}.`)
  }
  if (s.enabled && !s.connectionId) throw new ArchiveSettingsError('Choose the S3 connection to archive to.')
  return s
}

export async function saveArchiveJobSettings(db: D1Database, settings: ArchiveJobSettings): Promise<void> {
  await db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(ARCHIVE_JOBS_KEY, JSON.stringify(settings), nowIso())
    .run()
}

/** A copy in any of these counts as the job's backup: the Glacier classes, instant or not. */
const COLD = JSON.stringify([...ARCHIVE_CLASSES, 'GLACIER_IR'])
/** The job's photos (distinct, not deleted). */
const JOB_PHOTOS = `SELECT DISTINCT ai.asset_id FROM albums al JOIN album_items ai ON ai.album_id = al.id
  JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL WHERE al.job_id = ?1`
/** A photo has a cold copy in any S3 connection (any bucket counts: the agent may archive elsewhere). */
const HAS_COLD = `EXISTS (SELECT 1 FROM asset_locations l JOIN storage_connections c ON c.id = l.connection_id
  WHERE l.asset_id = p.asset_id AND c.provider = 's3' AND l.storage_class IN (SELECT value FROM json_each(?2)) AND l.state NOT IN ('pending', 'gone'))`
const HAS_R2 = `EXISTS (SELECT 1 FROM asset_locations l WHERE l.asset_id = p.asset_id AND l.connection_id = 'r2' AND l.state = 'present')`

export interface ArchiveNote {
  copy: number
  move: number
  nas: number
  bytes: number
}

/**
 * List a job's archive items: copies for R2 originals, class moves for warm S3 copies that may move, and a count of
 * NAS-only originals cf-dam can't copy. Marks the job queued, done or blocked. Returns what it found.
 */
export async function queueJobArchive(db: D1Database, jobId: string, settings: ArchiveJobSettings, storageClass: ArchiveJobClass = settings.storageClass): Promise<ArchiveNote> {
  const connectionId = settings.connectionId
  if (!connectionId) return { copy: 0, move: 0, nas: 0, bytes: 0 }
  const now = nowIso()
  const [copies, moves, counts] = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO archive_items (asset_id, connection_id, job_id, action, storage_class, updated_at)
         SELECT p.asset_id, ?3, ?1, 'copy', ?4, ?5 FROM (${JOB_PHOTOS}) p WHERE NOT ${HAS_COLD} AND ${HAS_R2}
         RETURNING asset_id`,
      )
      .bind(jobId, COLD, connectionId, storageClass, now),
    // A warm S3 copy and no R2: move it to the cold class, unless still offered as an original in an open gallery
    // or part of another job that isn't finished.
    db
      .prepare(
        `INSERT OR IGNORE INTO archive_items (asset_id, connection_id, job_id, action, storage_class, updated_at)
         SELECT p.asset_id, l.connection_id, ?1, 'move', ?4, ?5 FROM (${JOB_PHOTOS}) p
         JOIN asset_locations l ON l.asset_id = p.asset_id AND l.state = 'present' AND l.storage_class NOT IN (SELECT value FROM json_each(?2))
         JOIN storage_connections c ON c.id = l.connection_id AND c.provider = 's3'
         WHERE NOT ${HAS_COLD} AND NOT ${HAS_R2}
           AND NOT EXISTS (SELECT 1 FROM album_items x JOIN shares s ON s.album_id = x.album_id
                           WHERE x.asset_id = p.asset_id AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?5) AND s.download_sizes LIKE '%original%')
           AND NOT EXISTS (SELECT 1 FROM album_items x JOIN albums o ON o.id = x.album_id JOIN jobs oj ON oj.id = o.job_id
                           WHERE x.asset_id = p.asset_id AND oj.id != ?1 AND oj.stage NOT IN ('delivered', 'completed', 'cancelled'))
         GROUP BY p.asset_id
         RETURNING asset_id`,
      )
      .bind(jobId, COLD, connectionId, storageClass, now),
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN NOT ${HAS_COLD} AND NOT ${HAS_R2} AND NOT EXISTS (SELECT 1 FROM asset_locations l JOIN storage_connections c ON c.id = l.connection_id WHERE l.asset_id = p.asset_id AND c.provider = 's3' AND l.state NOT IN ('pending', 'gone')) THEN 1 ELSE 0 END) AS nas,
           SUM(CASE WHEN NOT ${HAS_COLD} AND ${HAS_R2} THEN (SELECT l.size FROM asset_locations l WHERE l.asset_id = p.asset_id AND l.connection_id = 'r2') ELSE 0 END) AS bytes
         FROM (${JOB_PHOTOS}) p`,
      )
      .bind(jobId, COLD),
  ])
  const waiting = await db.prepare("SELECT COUNT(*) AS n FROM archive_items WHERE job_id = ? AND state IN ('waiting', 'copying')").bind(jobId).first<{ n: number }>()
  const c = (counts!.results[0] ?? {}) as { nas: number | null; bytes: number | null }
  const note: ArchiveNote = { copy: copies!.results.length, move: moves!.results.length, nas: c.nas ?? 0, bytes: c.bytes ?? 0 }
  const state = (waiting?.n ?? 0) > 0 ? 'queued' : note.nas > 0 ? 'blocked' : 'done'
  await db
    .prepare('UPDATE jobs SET archive_state = ?, archive_note = ?, archived_at = CASE WHEN ? = \'done\' THEN COALESCE(archived_at, ?) ELSE archived_at END WHERE id = ?')
    .bind(state, JSON.stringify(note), state, now, jobId)
    .run()
  return note
}

/**
 * Sweep step: jobs due for archiving get their items listed (a few a run); queued jobs whose items are all done are
 * marked done; copies abandoned mid-step go back to waiting. Returns how many items are waiting.
 */
export interface JobsLook {
  shot: number
  due: number
  finished: number
  stale: number
  waiting: number
}

/**
 * The sweep's one look at job work, so a quiet minute costs one query: booked jobs whose shoot dates have passed
 * (jobs.ts sweepShot), jobs due for archiving (when it's on), queued archives with nothing left, copies abandoned
 * mid-step, and copies waiting.
 */
export async function jobsLook(db: D1Database): Promise<JobsLook> {
  const stale = new Date(Date.now() - 30 * 60_000).toISOString()
  return (await db
    .prepare(
      `WITH s AS (SELECT value FROM settings WHERE key = ?1)
       SELECT EXISTS (SELECT 1 FROM jobs WHERE stage = 'booked' AND shoot_start IS NOT NULL AND shoot_start <= substr(?3, 1, 10)) AS shot,
         EXISTS (SELECT 1 FROM jobs, s WHERE json_extract(s.value, '$.enabled') = 1 AND stage IN ('delivered', 'completed') AND keep_hot = 0
                 AND archive_state IS NULL AND archive_from IS NOT NULL
                 AND archive_from <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || CAST(COALESCE(json_extract(s.value, '$.afterDays'), 30) AS TEXT) || ' days')) AS due,
         EXISTS (SELECT 1 FROM jobs j WHERE j.archive_state = 'queued'
                 AND NOT EXISTS (SELECT 1 FROM archive_items i WHERE i.job_id = j.id AND i.state IN ('waiting', 'copying'))) AS finished,
         EXISTS (SELECT 1 FROM archive_items WHERE state = 'copying' AND updated_at < ?2) AS stale,
         (SELECT COUNT(*) FROM archive_items WHERE state = 'waiting') AS waiting`,
    )
    .bind(ARCHIVE_JOBS_KEY, stale, nowIso())
    .first<JobsLook>())!
}

export async function archiveStep(env: DamBindings, more: () => boolean, todo: JobsLook): Promise<number> {
  const db = env.DB
  const now = nowIso()
  const stale = new Date(Date.now() - 30 * 60_000).toISOString()
  if (todo.due && more()) {
    const settings = await getArchiveJobSettings(db)
    const due = new Date(Date.now() - settings.afterDays * 86_400_000).toISOString()
    const { results: jobs } = await db
      .prepare(
        `SELECT id FROM jobs WHERE stage IN ('delivered', 'completed') AND keep_hot = 0 AND archive_from IS NOT NULL AND archive_from <= ?
           AND archive_state IS NULL ORDER BY archive_from LIMIT 3`,
      )
      .bind(due)
      .all<{ id: string }>()
    for (const job of jobs) if (more()) await queueJobArchive(db, job.id, settings)
  }
  if (todo.finished && more()) {
    // Finished jobs: nothing of theirs waiting or being copied.
    const { results: finished } = await db
      .prepare(
        `SELECT j.id, j.title, j.archive_note,
           (SELECT COUNT(*) FROM archive_items i WHERE i.job_id = j.id AND i.state = 'failed') AS failed,
           (SELECT COUNT(*) FROM archive_items i WHERE i.job_id = j.id AND i.state = 'done') AS done
         FROM jobs j WHERE j.archive_state = 'queued'
           AND NOT EXISTS (SELECT 1 FROM archive_items i WHERE i.job_id = j.id AND i.state IN ('waiting', 'copying')) LIMIT 5`,
      )
      .all<{ id: string; title: string; archive_note: string | null; failed: number; done: number }>()
    for (const job of finished) {
      const note = JSON.parse(job.archive_note ?? '{}') as Partial<ArchiveNote>
      const state = job.failed > 0 ? 'failed' : (note.nas ?? 0) > 0 ? 'blocked' : 'done'
      await db.prepare('UPDATE jobs SET archive_state = ?, archived_at = ? WHERE id = ?').bind(state, now, job.id).run()
      if (job.done > 0) await logActivity(db, { userId: null, action: 'job.archived', targetType: 'job', targetId: job.id, details: { title: job.title, photos: job.done, failed: job.failed } })
    }
  }
  if (todo.stale) await db.prepare("UPDATE archive_items SET state = 'waiting' WHERE state = 'copying' AND updated_at < ?").bind(stale).run()
  if (!todo.due && !todo.stale) return todo.waiting
  const waiting = await db.prepare("SELECT COUNT(*) AS n FROM archive_items WHERE state = 'waiting'").first<{ n: number }>()
  return waiting?.n ?? 0
}

interface ItemRow {
  asset_id: string
  connection_id: string
  job_id: string | null
  action: 'copy' | 'move'
  storage_class: StorageClass
  key: string | null
  upload_id: string | null
  parts: string
  source_etag: string | null
  attempts: number
}

const base64 = (bytes: ArrayBuffer) => {
  let binary = ''
  const view = new Uint8Array(bytes)
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  return btoa(binary)
}
const sha256 = async (bytes: ArrayBuffer) => base64(await crypto.subtle.digest('SHA-256', bytes))
/** Like partSizeFor: 16 MiB, larger (whole MiB) when the file would need more than 10,000 parts. */
export const copyPartSize = (size: number) => Math.max(COPY_PART, Math.ceil(size / MAX_PARTS / 1048576) * 1048576)
const safeName = (filename: string) => filename.replace(/[^\w.\-]+/g, '_').slice(-120) || 'original'

class CopyFailed extends Error {}

/** Work-queue step (kind 'archive'): claim one item and work on it. Returns 'done', 'more' (carry on later) or 'none'. */
export async function archiveOne(env: DamBindings): Promise<'done' | 'more' | 'none'> {
  const db = env.DB
  const item = await db
    .prepare(
      `UPDATE archive_items SET state = 'copying', updated_at = ?1
       WHERE rowid IN (SELECT rowid FROM archive_items WHERE state = 'waiting' ORDER BY updated_at LIMIT 1) AND state = 'waiting'
       RETURNING *`,
    )
    .bind(nowIso())
    .first<ItemRow>()
  if (!item) return 'none'
  const save = (fields: Record<string, unknown>) => {
    const entries = Object.entries({ ...fields, updated_at: nowIso() })
    return db.prepare(`UPDATE archive_items SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE asset_id = ? AND connection_id = ?`)
      .bind(...entries.map(([, v]) => v), item.asset_id, item.connection_id)
      .run()
  }
  try {
    const connection = await getConnection(db, item.connection_id)
    if (!connection || connection.provider !== 's3') throw new CopyFailed('The archive connection is gone.')
    const s3 = providerFor(env, connection)
    if (item.action === 'move') await moveItem(db, s3, item)
    else {
      const result = await copyItem(env, s3, item, save)
      if (result === 'more') {
        await save({ state: 'waiting' })
        return 'more'
      }
    }
    await save({ state: 'done', upload_id: null, parts: '[]', error: null })
    return 'done'
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 300)
    const last = item.attempts + 1 >= MAX_ATTEMPTS
    // A last failure abandons the multipart upload (the bucket's lifecycle rule would too, after 7 days).
    if (last && item.upload_id && item.key) {
      const connection = await getConnection(db, item.connection_id).catch(() => null)
      if (connection) await providerFor(env, connection).abortMultipart(item.key, item.upload_id).catch(() => {})
    }
    await save({ state: last ? 'failed' : 'waiting', attempts: item.attempts + 1, error: message, ...(last ? { upload_id: null, parts: '[]' } : {}) }).catch(() => {})
    return 'done'
  }
}

/** A warm S3 copy moved to the cold class in place; the new ETag is kept so storage checks agree. */
async function moveItem(db: D1Database, s3: StorageProvider, item: ItemRow): Promise<void> {
  const location = await db.prepare('SELECT key, storage_class FROM asset_locations WHERE asset_id = ? AND connection_id = ?').bind(item.asset_id, item.connection_id).first<{ key: string; storage_class: string }>()
  if (!location) throw new CopyFailed('The S3 copy is gone.')
  if (ARCHIVE_CLASSES.has(location.storage_class)) return
  if (!s3.setStorageClass) throw new CopyFailed("This connection can't change classes.")
  await s3.setStorageClass(location.key, item.storage_class)
  const head = await s3.head(location.key)
  await db.prepare('UPDATE asset_locations SET storage_class = ?, etag = COALESCE(?, etag), size = COALESCE(?, size), updated_at = ? WHERE asset_id = ? AND connection_id = ?')
    .bind(item.storage_class, head?.etag ?? null, head?.size ?? null, nowIso(), item.asset_id, item.connection_id)
    .run()
}

/** Copy the R2 original to S3 (see the module comment). 'more' when the step's time ran out first. */
async function copyItem(env: DamBindings, s3: StorageProvider, item: ItemRow, save: (fields: Record<string, unknown>) => Promise<unknown>): Promise<'done' | 'more'> {
  const db = env.DB
  const started = Date.now()
  const [r2Connection, asset, source] = await Promise.all([
    getConnection(db, 'r2'),
    db.prepare('SELECT filename FROM assets WHERE id = ?').bind(item.asset_id).first<{ filename: string }>(),
    db.prepare("SELECT key FROM asset_locations WHERE asset_id = ? AND connection_id = 'r2' AND state = 'present'").bind(item.asset_id).first<{ key: string }>(),
  ])
  if (!r2Connection || !asset || !source) throw new CopyFailed('The R2 copy is gone.')
  const r2 = providerFor(env, r2Connection)
  const head = await r2.head(source.key)
  if (!head) throw new CopyFailed('The R2 copy is gone.')
  let { key, upload_id: uploadId } = item
  let parts = JSON.parse(item.parts) as CompletedPart[]
  // The R2 original changed since the copy began: start again from the new one.
  if (item.source_etag && item.source_etag !== head.etag) {
    if (uploadId && key) await s3.abortMultipart(key, uploadId).catch(() => {})
    uploadId = null
    parts = []
  }
  key ??= `originals/${item.asset_id}/${Date.now()}-${safeName(asset.filename)}`
  await save({ key, source_etag: head.etag })

  if (head.size <= COPY_PART) {
    const object = await r2.get(source.key)
    if (!object) throw new CopyFailed('The R2 copy is gone.')
    const bytes = await new Response(object.body).arrayBuffer()
    if (bytes.byteLength !== head.size) throw new CopyFailed('The R2 copy changed while it was read.')
    await s3.put(key, bytes, { storageClass: item.storage_class, sha256: await sha256(bytes) })
  } else {
    const partSize = copyPartSize(head.size)
    const count = Math.ceil(head.size / partSize)
    uploadId ??= await s3.createMultipart(key, { storageClass: item.storage_class, checksumSha256: true })
    await save({ upload_id: uploadId, parts: JSON.stringify(parts) })
    for (let n = parts.length + 1; n <= count; n++) {
      const offset = (n - 1) * partSize
      const length = Math.min(partSize, head.size - offset)
      const object = await r2.get(source.key, { offset, length })
      if (!object) throw new CopyFailed('The R2 copy is gone.')
      const bytes = await new Response(object.body).arrayBuffer()
      if (bytes.byteLength !== length) throw new CopyFailed('The R2 copy changed while it was read.')
      const checksum = await sha256(bytes)
      const { etag } = await s3.uploadPart(key, uploadId, n, bytes, length, { checksumSha256: checksum })
      parts.push({ partNumber: n, etag, checksumSha256: checksum })
      if (n % SAVE_EVERY === 0 || n === count) await save({ parts: JSON.stringify(parts) })
      if (n < count && Date.now() - started > STEP_MS) {
        await save({ parts: JSON.stringify(parts) })
        return 'more'
      }
    }
    // The original mustn't have changed under us.
    const after = await r2.head(source.key)
    if (!after || after.etag !== head.etag) throw new CopyFailed('The R2 copy changed during the copy.')
    await s3.completeMultipart(key, uploadId, parts)
  }
  const copied = await s3.head(key)
  if (!copied || copied.size !== head.size) throw new CopyFailed(`S3 has ${copied?.size ?? 0} bytes; the original has ${head.size}.`)
  await db
    .prepare(
      `INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, size, etag, updated_at)
       VALUES (?, ?, ?, ?, 'present', ?, ?, ?)
       ON CONFLICT (asset_id, connection_id) DO UPDATE SET key = excluded.key, storage_class = excluded.storage_class,
         state = 'present', size = excluded.size, etag = excluded.etag, restore_expires_at = NULL, updated_at = excluded.updated_at`,
    )
    .bind(item.asset_id, item.connection_id, key, copied.storageClass, copied.size, copied.etag, nowIso())
    .run()
  return 'done'
}

export interface ArchivePreview {
  jobs: number
  photos: number
  bytes: number
  /** Dollars a month to store what would be copied now, and once for the uploads. */
  monthly: number
  once: number
}

/** What turning archiving on (with these settings) would archive at once, before saving. */
export async function previewArchive(db: D1Database, settings: ArchiveJobSettings): Promise<ArchivePreview> {
  const due = new Date(Date.now() - settings.afterDays * 86_400_000).toISOString()
  const row = await db
    .prepare(
      `WITH jobs_due AS (SELECT id FROM jobs WHERE stage IN ('delivered', 'completed') AND keep_hot = 0 AND archive_from IS NOT NULL AND archive_from <= ?1 AND archive_state IS NULL),
       photos AS (SELECT DISTINCT ai.asset_id FROM jobs_due j JOIN albums al ON al.job_id = j.id JOIN album_items ai ON ai.album_id = al.id
                  JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL)
       SELECT (SELECT COUNT(*) FROM jobs_due) AS jobs, COUNT(*) AS photos, COALESCE(SUM(l.size), 0) AS bytes
       FROM photos p JOIN asset_locations l ON l.asset_id = p.asset_id AND l.connection_id = 'r2' AND l.state = 'present'
       WHERE NOT EXISTS (SELECT 1 FROM asset_locations x JOIN storage_connections c ON c.id = x.connection_id
                         WHERE x.asset_id = p.asset_id AND c.provider = 's3' AND x.storage_class IN (SELECT value FROM json_each(?2)) AND x.state NOT IN ('pending', 'gone'))`,
    )
    .bind(due, COLD)
    .first<{ jobs: number; photos: number; bytes: number }>()
  const price = ARCHIVE_PRICES[settings.storageClass]
  const bytes = row?.bytes ?? 0
  const photos = row?.photos ?? 0
  // A multipart copy is one request per part plus two; small files are one.
  const requests = photos + Math.ceil(bytes / COPY_PART)
  return { jobs: row?.jobs ?? 0, photos, bytes, monthly: (bytes / 1024 ** 3) * price.gbMonth, once: (requests / 1000) * price.putThousand }
}

/** A job's archive line: where it stands, and its items so far. */
export async function jobArchiveStatus(db: D1Database, jobId: string) {
  const job = await db.prepare('SELECT archive_from, keep_hot, archive_state, archive_note, archived_at FROM jobs WHERE id = ?').bind(jobId).first<{ archive_from: string | null; keep_hot: number; archive_state: string | null; archive_note: string | null; archived_at: string | null }>()
  if (!job) return null
  const items = await db
    .prepare("SELECT SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN state IN ('waiting', 'copying') THEN 1 ELSE 0 END) AS waiting, SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed, MAX(error) AS error FROM archive_items WHERE job_id = ?")
    .bind(jobId)
    .first<{ done: number | null; waiting: number | null; failed: number | null; error: string | null }>()
  const settings = await getArchiveJobSettings(db)
  return {
    keepHot: job.keep_hot === 1,
    state: job.archive_state,
    note: job.archive_note ? (JSON.parse(job.archive_note) as ArchiveNote) : null,
    archivedAt: job.archived_at,
    dueAt: settings.enabled && job.archive_from ? new Date(Date.parse(job.archive_from) + settings.afterDays * 86_400_000).toISOString() : null,
    done: items?.done ?? 0,
    waiting: items?.waiting ?? 0,
    failed: items?.failed ?? 0,
    error: items?.error ?? null,
  }
}

/** Keep hot on or off; turning it on stops a queued archive's waiting items. */
export async function setKeepHot(db: D1Database, jobId: string, keepHot: boolean): Promise<boolean> {
  const result = await db.prepare('UPDATE jobs SET keep_hot = ?, archive_state = CASE WHEN ? = 1 THEN NULL ELSE archive_state END WHERE id = ?').bind(keepHot ? 1 : 0, keepHot ? 1 : 0, jobId).run()
  if (keepHot) await db.prepare("DELETE FROM archive_items WHERE job_id = ? AND state = 'waiting'").bind(jobId).run()
  return result.meta.changes === 1
}
