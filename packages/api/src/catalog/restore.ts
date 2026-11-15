/**
 * Restore (plans/PLAN-S-v1.md, slice S3): bring a catalog back from a backup into a fresh install.
 *
 * Offered only on the setup page, before anyone has an account, and behind the setup token. The person
 * restoring says where the backups are (this install's built-in R2, or an S3 bucket), picks one, and the
 * sweep loads it a part at a time: every table in the backup, each after the tables it points at (in this
 * install's schema), as catalog/restore-load.ts puts rows back. Each group of rows goes in together with
 * the progress that says so, under the run's lease, so a part is never loaded twice, and rows that came
 * without what they belong to (written while the backup ran) are left out and counted. Then what backups leave out is
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
import { BACKUP_PREFIX, readChunk, readManifest, type BackupManifest } from './backups'
import {
  emptiedCounts,
  emptiedStatement,
  groupColumns,
  loadStatement,
  nextGroup,
  orderTables,
  parentsFirst,
  readKeys,
  selfKey,
  SEED_TABLES,
  withTimeout,
  type ForeignKey,
} from './restore-load'
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

/** What came back and what didn't, for the person restoring. */
export interface RestoreReport {
  /** Rows read from the backup, by table. */
  read: Record<string, number>
  /** Rows that went in, by table. */
  loaded: Record<string, number>
  /** Links emptied because what they pointed at wasn't in the backup, by "table.column". */
  emptied: Record<string, number>
  /** Worked out when the rows are in: rows left out, by table (read minus loaded). */
  left?: Record<string, number>
  /** Tables whose backup holds fewer rows than its manifest says (a damaged backup). */
  short?: Record<string, { expected: number; read: number }>
  /** Photos with no location at all: no original anywhere cf-dam knows. */
  noLocation?: number
  /** A restore the version before started: counted only from this table on (its earlier rows weren't counted). */
  since?: number
}

interface Progress {
  /** Moves on with every save: a save is only taken if the step it follows is still the one stored. */
  step: number
  phase: 'tables' | 'bands' | 'report' | 'reseed'
  /** Tables to load, each after the ones it points at, with the columns this schema has and the rows the manifest lists. */
  tables: { name: string; chunks: number; columns: string[]; rows?: number; files?: string[]; chunkRows?: number[] }[]
  table: number
  seq: number
  /** Rows of the current chunk already in. */
  offset: number
  /** For a table that points at itself: which pass over it, and how many rows it had when the pass began. */
  pass: number
  passFrom: number
  /** Bands: the last asset rowid done. */
  after: number
  report: RestoreReport
  /**
   * This version's migrations the backup didn't have. They ran on the empty database before the rows came in, so
   * their changes to rows are made again once the rows are in. Absent from a restore begun by an earlier version.
   */
  later?: string[]
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
  /** Once the rows are in: what didn't come back. */
  report: RestoreReport | null
}

/**
 * Settings a migration adds that mark one-off work in progress, not a default: a restore takes the backup's
 * (it has one only if the work hadn't finished), never this install's fresh one.
 */
export const ONE_OFF_SETTINGS = ['quick_hash.fill'] as const
/** Failed runs in a row before a restore stops. */
const MAX_FAILURES = 5
const LEASE_MS = 2 * 60_000
/** Reading one chunk gives up after this, well inside the lease. */
const READ_TIMEOUT_MS = 60_000
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

const view = (row: JobRow): RestoreView => {
  const progress = JSON.parse(row.progress) as Partial<Progress>
  return {
    id: row.id,
    backupId: row.backup_id,
    status: row.status,
    phase: progress.phase ?? 'tables',
    rows: row.rows,
    totalRows: row.total_rows,
    error: row.error,
    startedAt: row.started_at,
    report: row.status === 'restored' || row.status === 'finished' ? (progress.report ?? null) : null,
  }
}

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
    await db
      .prepare("UPDATE restore_jobs SET status = 'running', error = NULL, failures = 0, lease_until = NULL, lease_token = NULL, source = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(await storeSource(env, source)), now, job.id)
      .run()
    return view((await db.prepare('SELECT * FROM restore_jobs WHERE id = ?').bind(job.id).first<JobRow>())!)
  }

  const progress: Progress = {
    step: 0,
    phase: 'tables',
    tables: await tablesToLoad(db, manifest),
    table: 0,
    seq: 0,
    offset: 0,
    pass: 0,
    passFrom: 0,
    after: 0,
    report: { read: {}, loaded: {}, emptied: {} },
    later: MIGRATIONS.map((m) => m.name).filter((name) => !manifest.migrations.includes(name)),
  }
  const id = randomId()
  await db.batch([
    // One-off work this install's migrations started belongs to this install, not the catalog coming back.
    db.prepare(`DELETE FROM settings WHERE key IN (${ONE_OFF_SETTINGS.map(() => '?').join(', ')})`).bind(...ONE_OFF_SETTINGS),
    db
      .prepare('INSERT INTO restore_jobs (id, backup_id, source, status, progress, total_rows, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, backupId, JSON.stringify(await storeSource(env, source)), 'running', JSON.stringify(progress), manifest.tables.reduce((n, t) => n + t.rows, 0), now, now),
  ])
  return view((await db.prepare('SELECT * FROM restore_jobs WHERE id = ?').bind(id).first<JobRow>())!)
}

/**
 * The backup's tables with the columns each has in this install (a column a later version dropped is left
 * out), each after the tables it points at in this install's schema: a key a later version added between
 * two tables must not leave rows out only because their parents come later in the backup.
 */
async function tablesToLoad(db: D1Database, manifest: Pick<BackupManifest, 'tables'>): Promise<Progress['tables']> {
  const names = manifest.tables.map((t) => t.name)
  const [columns, keys] = await Promise.all([db.batch(names.map((name) => db.prepare('SELECT name FROM pragma_table_info(?)').bind(name))), readKeys(db, names)])
  const byName = new Map(
    manifest.tables.map((t, i) => [
      t.name,
      {
        name: t.name,
        chunks: t.chunks,
        rows: t.rows,
        columns: (columns[i]!.results as { name: string }[]).map((c) => c.name),
        ...(t.files ? { files: t.files } : {}),
        ...(t.chunkRows ? { chunkRows: t.chunkRows } : {}),
      },
    ]),
  )
  let order: string[]
  try {
    order = orderTables(names, (n) => keys.get(n)!.map((k) => k.parent))
  } catch (error) {
    throw new BadRequest(error instanceof Error ? error.message : String(error))
  }
  return order.map((n) => byName.get(n)!).filter((t) => t.columns.length > 0)
}

async function storeSource(env: DamBindings, source: RestoreSource): Promise<StoredSource> {
  if (source.kind === 'r2') return source
  const { secretAccessKey, ...rest } = source
  return { ...rest, secretSealed: await seal(await deriveKey(storageSecret(env)), secretAccessKey) }
}

/** The restore was taken over by another run (this one's lease ran out): this run stops writing. */
class LeaseLost extends Error {}

/** A progress saved by a version from before 2026-11-04: given what it lacks, the tables not started put in order again. */
async function upgradeProgress(db: D1Database, progress: Partial<Progress> & Pick<Progress, 'tables' | 'table'>): Promise<Progress> {
  const done = progress.tables.slice(0, progress.table + 1)
  const rest = progress.tables.slice(progress.table + 1)
  let tables = progress.tables
  if (rest.length > 0) {
    const keys = await readKeys(db, rest.map((t) => t.name))
    const byName = new Map(rest.map((t) => [t.name, t]))
    tables = [...done, ...orderTables(rest.map((t) => t.name), (n) => keys.get(n)!.map((k) => k.parent)).map((n) => byName.get(n)!)]
  }
  return { seq: 0, offset: 0, after: 0, phase: 'tables', ...progress, tables, step: 0, pass: 0, passFrom: 0, report: progress.report ?? { read: {}, loaded: {}, emptied: {}, since: progress.table + 1 } }
}

const add = (into: Record<string, number>, key: string, n: number) => {
  if (n) into[key] = (into[key] ?? 0) + n
}

/**
 * The sweep's turn: load as much as `more` allows. Returns null when no restore is running (or another
 * run holds it), else what it did.
 */
export async function restoreStep(env: DamBindings, more: () => boolean): Promise<{ rows: number; status: RestoreStatus } | null> {
  const db = env.DB
  const now = Date.now()
  const token = randomId()
  const job = await db
    .prepare(
      `UPDATE restore_jobs SET lease_until = ?, lease_token = ?
       WHERE id = (SELECT id FROM restore_jobs WHERE status = 'running' AND (lease_until IS NULL OR lease_until < ?) LIMIT 1) RETURNING *`,
    )
    .bind(new Date(now + LEASE_MS).toISOString(), token, new Date(now).toISOString())
    .first<JobRow>()
  if (!job) return null
  const stored = JSON.parse(job.progress) as Partial<Progress> & Pick<Progress, 'tables' | 'table'>
  // The step the stored progress is at (none, for a progress from before steps).
  let storedStep: number | null = typeof stored.step === 'number' ? stored.step : null
  let progress: Progress
  let loaded = 0
  let status: RestoreStatus = 'running'

  /**
   * Save `next` (and run `with`, gated on the save) only if this run still holds the job and the stored
   * progress is the one this run last saw. Returns the batch's results after the save's own.
   */
  const save = async (next: Progress, rowsRead: number, extra: { status?: RestoreStatus; release?: boolean } = {}, withStatements: (step: number) => D1PreparedStatement[] = () => []) => {
    next.step = (storedStep ?? -1) + 1
    const results = await db.batch([
      db
        .prepare(
          `UPDATE restore_jobs SET progress = ?, rows = rows + ?, failures = 0, error = NULL, updated_at = ?, lease_until = ?${extra.status ? ', status = ?' : ''}
           WHERE id = ? AND lease_token = ? AND json_extract(progress, '$.step') IS ?`,
        )
        .bind(
          JSON.stringify(next),
          rowsRead,
          nowIso(),
          extra.release ? null : new Date(Date.now() + LEASE_MS).toISOString(),
          ...(extra.status ? [extra.status] : []),
          job.id,
          token,
          storedStep,
        ),
      ...withStatements(next.step),
    ])
    if (results[0]!.meta.changes !== 1) throw new LeaseLost()
    storedStep = next.step
    return results.slice(1)
  }
  /** Each row goes in only if the save before it in the same batch was taken. */
  const guard = (step: number) => ({
    sql: `EXISTS (SELECT 1 FROM restore_jobs WHERE id = ? AND lease_token = ? AND json_extract(progress, '$.step') = ?)`,
    binds: [job.id, token, step],
  })
  const copy = (p: Progress): Progress => structuredClone(p)

  try {
    progress = storedStep === null ? await upgradeProgress(db, stored) : (stored as Progress)
    if (storedStep === null) {
      await save(progress, 0)
    }
    const provider = await storedProvider(env, JSON.parse(job.source) as StoredSource)
    const keys = await readKeys(db, progress.tables.map((t) => t.name))
    let chunk: { table: number; seq: number; pass: number; rows: Record<string, unknown>[] } | null = null

    while (more() && status === 'running') {
      if (progress.phase === 'tables') {
        const table = progress.tables[progress.table]
        if (!table) {
          const next = copy(progress)
          next.phase = 'bands'
          next.after = 0
          await save(next, 0)
          progress = next
          continue
        }
        const tableKeys: ForeignKey[] = keys.get(table.name) ?? []
        const self = selfKey(table.name, tableKeys)
        if (progress.seq >= table.chunks) {
          const next = copy(progress)
          // A table that points at itself: another pass while the last one added rows and some are still waiting.
          const count = self ? (await db.prepare(`SELECT COUNT(*) AS n FROM "${table.name.replace(/"/g, '""')}"`).first<{ n: number }>())!.n : 0
          if (self && count > progress.passFrom && count < (progress.report.read[table.name] ?? 0)) {
            Object.assign(next, { seq: 0, offset: 0, pass: progress.pass + 1, passFrom: count })
          } else {
            Object.assign(next, { table: progress.table + 1, seq: 0, offset: 0, pass: 0, passFrom: 0 })
          }
          await save(next, 0)
          progress = next
          continue
        }
        if (!chunk || chunk.table !== progress.table || chunk.seq !== progress.seq || chunk.pass !== progress.pass) {
          let rows = await withTimeout(readChunk(provider, job.backup_id, table.name, progress.seq, table.files?.[progress.seq]), READ_TIMEOUT_MS, 'Reading a backup chunk')
          if (self) rows = parentsFirst(rows, self)
          chunk = { table: progress.table, seq: progress.seq, pass: progress.pass, rows }
        }
        const rows = chunk.rows
        while (progress.offset < rows.length && more()) {
          const group = nextGroup(rows, progress.offset)
          const load = { name: table.name, columns: table.columns }
          const emptying = progress.pass === 0 ? emptiedStatement(db, load, tableKeys, group) : null
          const emptied = emptying ? await emptying.first<Record<string, number>>() : null
          const next = copy(progress)
          next.offset += group.length
          const first = progress.pass === 0
          if (first) add(next.report.read, table.name, group.length)
          for (const [key, n] of Object.entries(emptiedCounts(table.name, tableKeys, groupColumns(load, group), emptied))) add(next.report.emptied, key, n)
          const [inserted] = await save(next, first ? group.length : 0, {}, (step) => [loadStatement(db, load, tableKeys, group, guard(step))])
          // Counted into the next save (lost only if the run dies before it, which makes "left out" a little high).
          add(next.report.loaded, table.name, inserted!.meta.changes)
          progress = next
          if (first) loaded += group.length
        }
        if (progress.offset >= rows.length) {
          const next = copy(progress)
          Object.assign(next, { seq: progress.seq + 1, offset: 0 })
          // A table's last chunk read in full: the chunk counts the manifest lists, against what was read.
          await save(next, 0)
          progress = next
        }
      } else if (progress.phase === 'bands') {
        const next = copy(progress)
        next.after = await rebuildBands(db, progress.after)
        if (next.after < 0) {
          next.phase = 'report'
          next.after = 0
        }
        await save(next, 0)
        progress = next
      } else if (progress.phase === 'report') {
        const next = copy(progress)
        next.report = await reportOn(db, progress)
        next.phase = 'reseed'
        await save(next, 0)
        progress = next
      } else {
        const later = new Set(progress.later ?? [])
        // Migrations written as code are made to run again safely; any this backup predates go first.
        for (const m of MIGRATIONS) if (m.run && later.has(m.name)) await m.run(db)
        await save(copy(progress), 0, { status: 'restored', release: true }, () => [...seedStatements(db), ...laterRowChanges(db, later)])
        status = 'restored'
      }
    }
    if (status === 'running') await save(copy(progress), 0, { release: true })
  } catch (error) {
    if (error instanceof LeaseLost) return { rows: loaded, status }
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
    // Only the count and the reason: the progress stays as last saved, with the rows it says are in.
    const row = await db
      .prepare(
        `UPDATE restore_jobs SET failures = failures + 1, error = ?, updated_at = ?, lease_until = NULL,
           status = CASE WHEN failures + 1 >= ? THEN 'failed' ELSE status END
         WHERE id = ? AND lease_token = ? RETURNING status`,
      )
      .bind(message, nowIso(), MAX_FAILURES, job.id, token)
      .first<{ status: RestoreStatus }>()
      .catch(() => null)
    status = row?.status ?? status
    console.warn('[restore] run failed', job.id, message)
  }
  return { rows: loaded, status }
}

/** Once every row is in: what didn't come back, table by table. */
async function reportOn(db: D1Database, progress: Progress): Promise<RestoreReport> {
  const report: RestoreReport = { ...progress.report, left: {}, short: {} }
  for (const [i, table] of progress.tables.entries()) {
    if ((SEED_TABLES as readonly string[]).includes(table.name) || i < (report.since ?? 0)) continue
    const read = report.read[table.name] ?? 0
    const left = read - (report.loaded[table.name] ?? 0)
    if (left > 0) report.left![table.name] = left
    if (table.rows !== undefined && read < table.rows) report.short![table.name] = { expected: table.rows, read }
  }
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM assets a WHERE a.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM asset_locations l WHERE l.asset_id = a.id)')
    .first<{ n: number }>()
  report.noLocation = row?.n ?? 0
  return report
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

/**
 * What the migrations a backup predates did to rows (filling a new column from an old one, say), done again now the
 * rows are in, with any one-off work they start (a backup that predates the work can't carry its marker).
 */
function laterRowChanges(db: D1Database, later: ReadonlySet<string>): D1PreparedStatement[] {
  const seeded = new RegExp(`^INSERT OR IGNORE INTO (${SEED_TABLES.join('|')})\\b`, 'i')
  return MIGRATIONS.filter((m) => m.sql && later.has(m.name))
    .flatMap((m) => splitStatements(m.sql!))
    .filter((s) => /^(UPDATE|DELETE|INSERT)\b/i.test(s.trim()))
    .filter((s) => !seeded.test(s.trim()) || ONE_OFF_SETTINGS.some((key) => s.includes(`'${key}'`)))
    .map((s) => db.prepare(s))
}

/** Every migration's INSERT OR IGNORE into the seeded tables: what this version adds comes back. */
function seedStatements(db: D1Database): D1PreparedStatement[] {
  const pattern = new RegExp(`^INSERT OR IGNORE INTO (${SEED_TABLES.join('|')})\\b`, 'i')
  return MIGRATIONS.flatMap((m) => splitStatements(m.sql ?? ''))
    .filter((s) => pattern.test(s.trim()) && !ONE_OFF_SETTINGS.some((key) => s.includes(`'${key}'`)))
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
  // The backup's "alerts last looked at" is hours old: without this, "background work has stopped" would greet them.
  const checked = db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('alerts.checked_at', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(now, now)
  if (!user) {
    // A new administrator: signed up through Better Auth by the caller, once this is marked finished.
    await db.batch([finished, checked])
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
    checked,
  ])
  return { userId: user.id, existing: true }
}
