/**
 * Restore (plans/PLAN-S-v1.md, slice S3): bring a catalog back from a backup into a fresh install.
 *
 * Offered only on the setup page, before anyone has an account, and behind the setup token. The person
 * restoring says where the backups are (this install's built-in R2, or an S3 bucket), picks one, and the
 * sweep loads it a part at a time: every table in the backup, in the order the backup wrote them,
 * replacing rows with the same rowid, so a part done twice does no harm. Then what backups leave out is
 * rebuilt: the look-alike bands (from the hashes), the search index (every photo is marked for the
 * sweep to reindex), and the roles and permissions this version of cf-dam adds. Nobody comes back with a
 * password, a second-factor secret or a session; the person restoring chooses their own sign-in
 * (`finishRestore`), and sets temporary passwords for everyone else on the People page.
 *
 * Until then the install stays on its setup page and refuses sign-ins (`setupNeeded`).
 */
import { MIGRATIONS, splitStatements } from '../db/migrate'
import type { DamBindings } from '../env'
import { BadRequest, requiredString } from '../lib/http'
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { underPrefix, validateEndpoint } from '../storage/connections'
import { R2Provider } from '../storage/r2'
import { S3Provider } from '../storage/s3'
import { deriveKey, open, seal, storageSecret } from '../storage/secret-box'
import type { StorageProvider } from '../storage/types'
import { BACKUP_PREFIX, insertRows, INSERT_ROWS, readChunk, readManifest, type BackupManifest } from './backups'
import { bands, bitsSet, MIN_DETAIL_BITS } from './dhash'
import { say } from '../lib/language'

/** Where the backup is, as the person restoring gives it. */
export type RestoreSource =
  | { kind: 'r2' }
  | { kind: 's3'; endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string; prefix?: string }
type StoredSource =
  | { kind: 'r2' }
  | { kind: 's3'; endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretSealed: string; prefix?: string }

export type RestoreStatus = 'running' | 'restored' | 'finished' | 'failed'

interface Progress {
  phase: 'tables' | 'bands' | 'reseed'
  /** Tables to load, in the backup's order, with the columns this schema has. */
  tables: { name: string; chunks: number; columns: string[] }[]
  table: number
  seq: number
  /** Rows of the current chunk already in. */
  offset: number
  /** Bands: the last asset rowid done. */
  after: number
}

interface JobRow {
  id: string
  backup_id: string
  source: string
  status: RestoreStatus
  progress: string
  rows: number
  total_rows: number
  error: string | null
  failures: number
  started_at: string
  finished_at: string | null
}

export interface RestoreView {
  id: string
  backupId: string
  status: RestoreStatus
  phase: Progress['phase']
  rows: number
  totalRows: number
  error: string | null
  startedAt: string
}

/** Columns given a value of their own rather than the backed-up one. */
const OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // The search tables aren't backed up: every photo goes back in the sweep's queue to be indexed.
  assets: { indexed_at: 'NULL' },
  // Second-factor secrets aren't backed up, so nobody comes back with codes turned on.
  users: { two_factor_enabled: '0' },
}
/** Seed rows later versions add (permissions for new pages, and the like), put back after the load. */
const SEED_TABLES = ['roles', 'permissions', 'role_permissions', 'storage_connections', 'settings']
const MAX_FAILURES = 5
const LEASE_MS = 2 * 60_000
const BANDS_PER_PAGE = 500
/** Backups listed to choose from, newest first. */
const LIST_LIMIT = 20

export function parseSource(body: Record<string, unknown>): RestoreSource {
  const source = body.source
  if (!source || typeof source !== 'object') throw new BadRequest('source is required.')
  const s = source as Record<string, unknown>
  if (s.kind === 'r2') return { kind: 'r2' }
  if (s.kind !== 's3') throw new BadRequest("source.kind must be 'r2' or 's3'.")
  let endpoint: string
  try {
    endpoint = validateEndpoint(requiredString(s, 'endpoint', 500))
  } catch (error) {
    throw new BadRequest(error instanceof Error ? error.message : 'The endpoint is not valid.')
  }
  return {
    kind: 's3',
    endpoint,
    region: typeof s.region === 'string' && s.region.trim() ? s.region.trim() : 'us-east-1',
    bucket: requiredString(s, 'bucket', 255),
    forcePathStyle: s.forcePathStyle === true,
    accessKeyId: requiredString(s, 'accessKeyId', 255),
    secretAccessKey: requiredString(s, 'secretAccessKey', 255),
    // The connection's prefix, if it had one: backups are under it.
    prefix: typeof s.prefix === 'string' ? s.prefix.trim().replace(/^\/+|\/+$/g, '') : '',
  }
}

export function sourceProvider(env: DamBindings, source: RestoreSource): StorageProvider {
  if (source.kind === 'r2') {
    if (!env.MEDIA_BUCKET) throw new BadRequest(say('err.noR2'))
    return new R2Provider(env.MEDIA_BUCKET)
  }
  const { accessKeyId, secretAccessKey } = source
  const provider = new S3Provider({ endpoint: source.endpoint, region: source.region, bucket: source.bucket, forcePathStyle: source.forcePathStyle, credentials: async () => ({ accessKeyId, secretAccessKey }) })
  return underPrefix(provider, source.prefix ?? '')
}

async function storedProvider(env: DamBindings, stored: StoredSource): Promise<StorageProvider> {
  if (stored.kind === 'r2') return sourceProvider(env, stored)
  const secretAccessKey = await open(await deriveKey(storageSecret(env)), stored.secretSealed)
  return sourceProvider(env, { ...stored, secretAccessKey })
}

/** Why this install can't load a backup, or null if it can: it must know every migration the backup had. */
export function incompatibility(manifest: BackupManifest): string | null {
  const known = new Set(MIGRATIONS.map((m) => m.name))
  const newer = manifest.migrations.filter((m) => !known.has(m))
  return newer.length > 0 ? `Made by a newer version of cf-dam (it has ${newer.join(', ')}). Update this install first, then restore.` : null
}

export interface BackupListing {
  id: string
  startedAt: string
  finishedAt: string
  rows: number
  photos: number
  problem: string | null
}

/** The finished backups in a bucket, newest first. */
export async function listBackups(provider: StorageProvider): Promise<BackupListing[]> {
  const ids: string[] = []
  let cursor: string | null = null
  for (let page = 0; page < 50; page++) {
    const listed: { objects: { key: string }[]; cursor: string | null } = await provider.list(`${BACKUP_PREFIX}/`, cursor ?? undefined)
    for (const { key } of listed.objects) {
      const match = /^cf-dam-backups\/([^/]+)\/manifest\.json$/.exec(key)
      if (match) ids.push(match[1]!)
    }
    cursor = listed.cursor
    if (!cursor) break
  }
  const manifests = await Promise.all(ids.sort().reverse().slice(0, LIST_LIMIT).map((id) => readManifest(provider, id).catch(() => null)))
  return manifests
    .filter((m): m is BackupManifest => m !== null)
    .map((m) => ({
      id: m.id,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt,
      rows: m.tables.reduce((n, t) => n + t.rows, 0),
      photos: m.tables.find((t) => t.name === 'assets')?.rows ?? 0,
      problem: incompatibility(m),
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

const view = (row: JobRow): RestoreView => ({
  id: row.id,
  backupId: row.backup_id,
  status: row.status,
  phase: (JSON.parse(row.progress) as Progress).phase,
  rows: row.rows,
  totalRows: row.total_rows,
  error: row.error,
  startedAt: row.started_at,
})

/** The restore under way, waiting for a sign-in, or failed; null if there is none (or it finished). */
export async function currentRestore(db: D1Database): Promise<RestoreView | null> {
  const row = await db
    .prepare("SELECT * FROM restore_jobs WHERE status != 'finished' ORDER BY started_at DESC LIMIT 1")
    .first<JobRow>()
    // A database from before restores (migration tests): there is none.
    .catch(() => null)
  return row ? view(row) : null
}

/** Start loading a backup. Only into an install nobody has an account on yet. */
export async function startRestore(env: DamBindings, source: RestoreSource, backupId: string): Promise<RestoreView> {
  const db = env.DB
  const [users, existing] = await db.batch([
    db.prepare('SELECT 1 FROM users LIMIT 1'),
    db.prepare("SELECT id, status, backup_id FROM restore_jobs WHERE status != 'finished' LIMIT 1"),
  ])
  if (users!.results.length > 0 && existing!.results.length === 0) throw new BadRequest(say('err.restoreHasAccounts'))
  const job = existing!.results[0] as { id: string; status: RestoreStatus; backup_id: string } | undefined
  if (job && job.status !== 'failed') throw new BadRequest(say('err.restoreRunning'))
  // After a failure, only the same backup may be tried again: it carries on where it stopped.
  if (job && job.backup_id !== backupId) throw new BadRequest(say('err.restorePartLoaded', { id: job.backup_id }))

  const manifest = await readManifest(sourceProvider(env, source), backupId).catch((error) => {
    throw new BadRequest(say('err.restoreUnreadable', { error: error instanceof Error ? error.message : String(error) }))
  })
  if (!manifest) throw new BadRequest(say('err.backupMissing', { id: backupId }))
  const problem = incompatibility(manifest)
  if (problem) throw new BadRequest(problem)

  const now = nowIso()
  if (job) {
    await db.prepare("UPDATE restore_jobs SET status = 'running', error = NULL, failures = 0, lease_until = NULL, source = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(await storeSource(env, source)), now, job.id).run()
    return view((await db.prepare('SELECT * FROM restore_jobs WHERE id = ?').bind(job.id).first<JobRow>())!)
  }

  // The columns each table has now: a column a later version dropped is left out.
  const present = manifest.tables.map((t) => t.name)
  const columns = await db.batch(present.map((name) => db.prepare('SELECT name FROM pragma_table_info(?)').bind(name)))
  const tables = manifest.tables
    .map((t, i) => ({ name: t.name, chunks: t.chunks, columns: (columns[i]!.results as { name: string }[]).map((c) => c.name) }))
    .filter((t) => t.columns.length > 0)
  const progress: Progress = { phase: 'tables', tables, table: 0, seq: 0, offset: 0, after: 0 }
  const id = randomId()
  await db
    .prepare('INSERT INTO restore_jobs (id, backup_id, source, status, progress, total_rows, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, backupId, JSON.stringify(await storeSource(env, source)), 'running', JSON.stringify(progress), manifest.tables.reduce((n, t) => n + t.rows, 0), now, now)
    .run()
  return view((await db.prepare('SELECT * FROM restore_jobs WHERE id = ?').bind(id).first<JobRow>())!)
}

async function storeSource(env: DamBindings, source: RestoreSource): Promise<StoredSource> {
  if (source.kind === 'r2') return source
  const { secretAccessKey, ...rest } = source
  return { ...rest, secretSealed: await seal(await deriveKey(storageSecret(env)), secretAccessKey) }
}

/**
 * The sweep's turn: load as much as `more` allows. Returns null when no restore is running (or another
 * run holds it), else what it did.
 */
export async function restoreStep(env: DamBindings, more: () => boolean): Promise<{ rows: number; status: RestoreStatus } | null> {
  const db = env.DB
  const now = Date.now()
  const job = await db
    .prepare("UPDATE restore_jobs SET lease_until = ? WHERE id = (SELECT id FROM restore_jobs WHERE status = 'running' AND (lease_until IS NULL OR lease_until < ?) LIMIT 1) RETURNING *")
    .bind(new Date(now + LEASE_MS).toISOString(), new Date(now).toISOString())
    .first<JobRow>()
  if (!job) return null
  const progress = JSON.parse(job.progress) as Progress
  let loaded = 0
  let status: RestoreStatus = 'running'
  const save = (extra = '', ...binds: unknown[]) =>
    db.prepare(`UPDATE restore_jobs SET progress = ?, rows = rows + ?, updated_at = ?${extra} WHERE id = ?`).bind(JSON.stringify(progress), loaded, nowIso(), ...binds, job.id)

  try {
    const provider = await storedProvider(env, JSON.parse(job.source) as StoredSource)
    while (more() && status === 'running') {
      if (progress.phase === 'tables') {
        const table = progress.tables[progress.table]
        if (!table) {
          progress.phase = 'bands'
          continue
        }
        if (progress.seq >= table.chunks) {
          Object.assign(progress, { table: progress.table + 1, seq: 0, offset: 0 })
          continue
        }
        const rows = await readChunk(provider, job.backup_id, table.name, progress.seq)
        while (progress.offset < rows.length && more()) {
          const group = rows.slice(progress.offset, progress.offset + INSERT_ROWS)
          await insertRows(db, table.name, group, { columns: table.columns, overrides: OVERRIDES[table.name] }).run()
          progress.offset += group.length
          loaded += group.length
        }
        if (progress.offset >= rows.length) Object.assign(progress, { seq: progress.seq + 1, offset: 0 })
        await save().run()
        loaded = 0
      } else if (progress.phase === 'bands') {
        progress.after = await rebuildBands(db, progress.after)
        if (progress.after < 0) {
          progress.phase = 'reseed'
          progress.after = 0
        }
      } else {
        await db.batch(seedStatements(db))
        status = 'restored'
      }
    }
    await save(', status = ?, lease_until = NULL', status).run()
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
    const failed = job.failures + 1 >= MAX_FAILURES
    if (failed) status = 'failed'
    await save(', failures = failures + 1, error = ?, status = ?, lease_until = NULL', message, status).run()
    console.warn('[restore] run failed', job.id, message)
  }
  return { rows: loaded, status }
}

/** Look-alike bands for the next page of photos with a hash; the last rowid done, or -1 when none are left. */
async function rebuildBands(db: D1Database, after: number): Promise<number> {
  const { results } = await db
    .prepare('SELECT rowid AS r, id, phash FROM assets WHERE rowid > ? AND phash IS NOT NULL ORDER BY rowid LIMIT ?')
    .bind(after, BANDS_PER_PAGE)
    .all<{ r: number; id: string; phash: string }>()
  const rows = results.filter((a) => bitsSet(a.phash) >= MIN_DETAIL_BITS).flatMap((a) => bands(a.phash).map((value, band) => [a.id, band, value]))
  if (rows.length > 0) {
    await db
      .prepare("INSERT OR REPLACE INTO asset_hash_bands (asset_id, band, value) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?)")
      .bind(JSON.stringify(rows))
      .run()
  }
  return results.length < BANDS_PER_PAGE ? -1 : results.at(-1)!.r
}

/** Every migration's INSERT OR IGNORE into the seeded tables: what this version adds comes back. */
function seedStatements(db: D1Database): D1PreparedStatement[] {
  const pattern = new RegExp(`^INSERT OR IGNORE INTO (${SEED_TABLES.join('|')})\\b`, 'i')
  return MIGRATIONS.flatMap((m) => splitStatements(m.sql ?? ''))
    .filter((s) => pattern.test(s.trim()))
    .map((s) => db.prepare(s))
}

export interface SignIn {
  name: string
  email: string
  password: string
}

/**
 * The rows are in: the person restoring gets their sign-in. Theirs if the backup has their email (made
 * an administrator), or a new administrator's. Returns whether the account was already in the backup.
 */
export async function finishRestore(db: D1Database, hash: (password: string) => Promise<string>, signIn: SignIn): Promise<{ userId: string | null; existing: boolean }> {
  const job = await db.prepare("SELECT id FROM restore_jobs WHERE status = 'restored' LIMIT 1").first<{ id: string }>()
  if (!job) throw new BadRequest(say('err.restoreNoSignIn'))
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(signIn.email.toLowerCase()).first<{ id: string }>()
  const now = nowIso()
  const finished = db.prepare("UPDATE restore_jobs SET status = 'finished', finished_at = ?, updated_at = ? WHERE id = ?").bind(now, now, job.id)
  if (!user) {
    // A new administrator: signed up through Better Auth by the caller, once this is marked finished.
    await finished.run()
    return { userId: null, existing: false }
  }
  await db.batch([
    db.prepare("DELETE FROM account WHERE user_id = ? AND provider_id = 'credential'").bind(user.id),
    db
      .prepare("INSERT INTO account (id, user_id, account_id, provider_id, password, created_at, updated_at) VALUES (?, ?, ?, 'credential', ?, ?, ?)")
      .bind(randomId(), user.id, user.id, await hash(signIn.password), now, now),
    db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id, created_at) VALUES (?, 'role-admin', ?)").bind(user.id, now),
    db.prepare('UPDATE users SET must_change_password = 0, failed_sign_ins = 0, locked_until = NULL, updated_at = ? WHERE id = ?').bind(now, user.id),
    finished,
  ])
  return { userId: user.id, existing: true }
}
