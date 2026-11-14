/**
 * Catalog backups (plans/PLAN-S-v1.md, slice S2): every table, except secrets and what's rebuilt from
 * others, copied daily to a storage connection the photographer chooses.
 *
 * A backup is gzipped NDJSON, one object per chunk of a table's rows, under `cf-dam-backups/<id>/`,
 * and a `manifest.json` written last: a backup without one is unfinished. Large catalogs take many
 * sweeps; rows are paged by rowid, so none is missed or read twice, each as it was when read (Time
 * Travel stays the point-in-time restore inside Cloudflare). Tables are ordered by their foreign keys,
 * so each loads back after the tables it points at (creation order isn't enough: a migration that
 * rebuilds a table moves it to the end).
 *
 * Left out: sign-in secrets (people come back without passwords, codes or sessions; an admin sets
 * temporary passwords), work in flight, and what's rebuilt. Agents pair again; keyed connections need
 * their keys again; keyless ones work as they are.
 */
import type { DamBindings } from '../env'
import { logActivity } from '../lib/activity'
import { nowIso } from '../lib/time'
import { getConnection, providerFor, underPrefix, type Connection } from '../storage/connections'
import type { StorageProvider } from '../storage/types'
import { randomId } from '../lib/crypto'
import { GROUP_ROWS, loadStatement, nextGroup, orderTables, parentsFirst, readKeys, selfKey, withTimeout } from './restore-load'

export const BACKUP_PREFIX = 'cf-dam-backups'
export const BACKUP_FORMAT = 'cf-dam-catalog-backup'
const PAGE_ROWS = 1000
export const CHUNK_ROWS = 5000
const PRUNE_PER_RUN = 50
/** Runs in a row a backup may fail (storage down, say) before it's given up for the day. */
const MAX_FAILURES = 3
/** A run holds the backup this long at most; an overlapping sweep leaves it alone meanwhile. */
const LEASE_MS = 2 * 60_000
/** A chunk's upload gives up after this, well inside the lease. */
const PUT_TIMEOUT_MS = 60_000

/** Tables never backed up, and why. */
export const OMITTED_TABLES: Readonly<Record<string, string>> = {
  account: 'password hashes',
  session: 'signed-in sessions',
  verification: 'single-use codes and links',
  client_invites: 'single-use invite links',
  two_factor: 'sign-in code secrets',
  api_keys: 'API key hashes',
  signing_keys: 'private keys for keyless AWS (new ones are made)',
  pairing_requests: 'agent pairings in progress',
  uploads: 'uploads in progress',
  mail_outbox: 'email addresses and one-time links',
  payment_secrets: 'the Stripe key and webhook secret (enter them again after a restore)',
  stripe_events: 'Stripe events already handled',
  archive_items: 'archive copies in progress (the sweep finds the photos again from their jobs)',
  restore_items: 'restores being asked for (the sweep finds the photos again from their locations)',
  asset_hash_bands: 'rebuilt from assets',
  backups: 'the list of backups itself',
  alerts: 'found again by the sweep',
  restore_jobs: 'restores into this install',
  preview_requests: 'found again by a preview check',
  _migrations: 'listed in the manifest instead',
}
/** Secret columns left out of tables that are backed up. Columns pointing into an omitted table are left out too (found from the foreign keys). */
export const OMITTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  sources: ['key_hash'],
  storage_connections: ['secret_sealed'],
}

export interface BackupConfig {
  /** Where backups go; null turns them off. */
  connectionId: string | null
  /** The hour (UTC) the daily backup starts. */
  hour: number
  keepDays: number
}
export const DEFAULT_BACKUP_CONFIG: BackupConfig = { connectionId: 'r2', hour: 3, keepDays: 30 }
const CONFIG_KEY = 'backup'
const STATE_KEY = 'backup.state'

interface TableCount {
  rows: number
  chunks: number
  /** Each chunk's rows. */
  chunkRows?: number[]
  /** Each chunk's file name, when it isn't the plain `00000.ndjson.gz` (each run writes its own, so a late upload can't overwrite another's). */
  files?: string[]
}

/** A backup in progress, kept in `settings` between sweeps. */
export interface BackupState {
  id: string
  connectionId: string
  startedAt: string
  tables: string[]
  /** Columns left out, by table: the secret ones, and those pointing into an omitted table. */
  omit: Record<string, string[]>
  /** The table being copied, by index into `tables`, and the last rowid copied from it. */
  table: number
  after: number
  counts: Record<string, TableCount>
  bytes: number
  /** Runs in a row that failed. */
  failures: number
  /** The run holding the backup, and until when. */
  leaseToken?: string | null
  leaseUntil?: string | null
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  version: 1
  id: string
  startedAt: string
  finishedAt: string
  migrations: string[]
  tables: {
    name: string
    rows: number
    chunks: number
    omittedColumns: readonly string[]
    /** Each chunk's rows (backups from 2026-11 on): a restore checks what it reads against them. */
    chunkRows?: number[]
    /** Each chunk's file name (backups from 2026-11 on); otherwise `chunkKey`'s plain one. */
    files?: string[]
  }[]
  omittedTables: Readonly<Record<string, string>>
}

export const backupRoot = (id: string) => `${BACKUP_PREFIX}/${id}/`
const plainChunkFile = (seq: number) => `${String(seq).padStart(5, '0')}.ndjson.gz`
export const chunkKey = (id: string, table: string, seq: number, file?: string) => `${backupRoot(id)}${table}/${file ?? plainChunkFile(seq)}`
const chunkFile = (seq: number, token: string) => `${String(seq).padStart(5, '0')}-${token.slice(0, 8)}.ndjson.gz`
const manifestKey = (id: string) => `${backupRoot(id)}manifest.json`
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

async function saveSetting(db: D1Database, key: string, value: unknown): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, JSON.stringify(value), nowIso())
    .run()
}

export function parseConfig(value: string | null | undefined): BackupConfig {
  if (!value) return DEFAULT_BACKUP_CONFIG
  try {
    return { ...DEFAULT_BACKUP_CONFIG, ...(JSON.parse(value) as Partial<BackupConfig>) }
  } catch {
    return DEFAULT_BACKUP_CONFIG
  }
}

export async function getBackupConfig(db: D1Database): Promise<BackupConfig> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(CONFIG_KEY).first<{ value: string }>()
  return parseConfig(row?.value)
}

export async function setBackupConfig(db: D1Database, config: BackupConfig): Promise<void> {
  await saveSetting(db, CONFIG_KEY, config)
}

export async function getBackupState(db: D1Database): Promise<BackupState | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(STATE_KEY).first<{ value: string }>()
  return row ? (JSON.parse(row.value) as BackupState) : null
}

export interface BackupPlan {
  /** Every table but secrets, search tables and SQLite's own, each after the tables it points at. */
  tables: string[]
  omit: Record<string, string[]>
}

export async function backupPlan(db: D1Database): Promise<BackupPlan> {
  const { results } = await db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY rowid").all<{ name: string; sql: string | null }>()
  const virtual = results.filter((t) => /^CREATE VIRTUAL TABLE/i.test(t.sql ?? '')).map((t) => t.name)
  const names = results
    .map((t) => t.name)
    .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_cf_') && !(name in OMITTED_TABLES))
    .filter((name) => !virtual.some((v) => name === v || name.startsWith(`${v}_`)))

  const keys = await db.batch(names.map((name) => db.prepare('SELECT "table" AS target, "from" AS col FROM pragma_foreign_key_list(?)').bind(name)))
  const pointsAt = new Map<string, Set<string>>()
  const omit: Record<string, string[]> = {}
  names.forEach((name, i) => {
    const refs = keys[i]!.results as { target: string; col: string }[]
    pointsAt.set(name, new Set(refs.filter((r) => r.target !== name && names.includes(r.target)).map((r) => r.target)))
    const cols = [...(OMITTED_COLUMNS[name] ?? []), ...refs.filter((r) => !names.includes(r.target) && r.target in OMITTED_TABLES).map((r) => r.col)]
    if (cols.length > 0) omit[name] = [...new Set(cols)]
  })

  // Creation order, except that a table waits for the ones it points at.
  return { tables: orderTables(names, (n) => pointsAt.get(n)!), omit }
}

/** The daily backup is due: its hour has come today (UTC), and none has started since. */
export function backupDue(config: BackupConfig, lastStartedAt: string | null, now = new Date()): boolean {
  if (!config.connectionId) return false
  const scheduled = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), config.hour))
  if (scheduled > now) scheduled.setUTCDate(scheduled.getUTCDate() - 1)
  return !lastStartedAt || lastStartedAt < scheduled.toISOString()
}

async function destination(env: DamBindings, connectionId: string): Promise<{ connection: Connection; provider: StorageProvider }> {
  const connection = await getConnection(env.DB, connectionId)
  if (!connection || connection.provider === 'nas') throw new Error('The backup destination no longer exists. Choose another on the Storage page.')
  // Under the connection's prefix (cf-dam-backups/<id>/ inside it): a keyless role may only write there.
  return { connection, provider: underPrefix(providerFor(env, connection), connection.prefix) }
}

/**
 * Start a backup now. Returns null if one is already running. Its progress and its row in `backups` go
 * in together or not at all, and only for the one start that wins when two overlap.
 */
export async function startBackup(env: DamBindings, connectionId: string): Promise<BackupState | null> {
  const db = env.DB
  if (await getBackupState(db)) return null
  await destination(env, connectionId)
  const startedAt = nowIso()
  const state: BackupState = {
    id: startedAt.replace(/[:.]/g, '-'),
    connectionId,
    startedAt,
    ...(await backupPlan(db)),
    table: 0,
    after: 0,
    counts: {},
    bytes: 0,
    failures: 0,
    leaseToken: null,
    leaseUntil: null,
  }
  const [started] = await db.batch([
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING').bind(STATE_KEY, JSON.stringify(state), startedAt),
    db
      .prepare(
        `INSERT INTO backups (id, connection_id, status, started_at)
         SELECT ?, ?, 'running', ? WHERE json_extract((SELECT value FROM settings WHERE key = ?), '$.id') = ?
         ON CONFLICT DO NOTHING`,
      )
      .bind(state.id, connectionId, startedAt, STATE_KEY, state.id),
  ])
  return started!.meta.changes === 1 ? state : null
}

/** Another run took the backup over (its lease ran out): this one stops without writing anything more. */
class LeaseLost extends Error {}

/** Take the backup for this run, unless another run holds it. */
async function takeLease(db: D1Database, token: string): Promise<BackupState | null> {
  const now = Date.now()
  const row = await db
    .prepare(
      `UPDATE settings SET value = json_set(value, '$.leaseToken', ?, '$.leaseUntil', ?), updated_at = ?
       WHERE key = ? AND (json_extract(value, '$.leaseUntil') IS NULL OR json_extract(value, '$.leaseUntil') < ?)
       RETURNING value`,
    )
    .bind(token, new Date(now + LEASE_MS).toISOString(), nowIso(), STATE_KEY, new Date(now).toISOString())
    .first<{ value: string }>()
  return row ? (JSON.parse(row.value) as BackupState) : null
}

/**
 * Save the backup's progress, only if this run still holds it and nobody has moved it on meanwhile.
 * `release` hands the backup back for the next run.
 */
async function saveState(db: D1Database, state: BackupState, was: { table: number; after: number }, release = false): Promise<void> {
  const next: BackupState = { ...state, leaseUntil: release ? null : new Date(Date.now() + LEASE_MS).toISOString() }
  const saved = await db
    .prepare(
      `UPDATE settings SET value = ?, updated_at = ?
       WHERE key = ? AND json_extract(value, '$.leaseToken') = ? AND json_extract(value, '$.table') = ? AND json_extract(value, '$.after') = ?`,
    )
    .bind(JSON.stringify(next), nowIso(), STATE_KEY, state.leaseToken, was.table, was.after)
    .run()
  if (saved.meta.changes !== 1) throw new LeaseLost()
  state.leaseUntil = next.leaseUntil
}

async function gzip(text: string): Promise<ArrayBuffer> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
}

/** Copy chunks while `more()` allows. Returns true when every table is copied. */
async function copyTables(db: D1Database, provider: StorageProvider, state: BackupState, more: () => boolean): Promise<boolean> {
  while (state.table < state.tables.length) {
    if (!more()) return false
    const was = { table: state.table, after: state.after }
    const table = state.tables[state.table]!
    const omit = state.omit[table] ?? []
    const rows: Record<string, unknown>[] = []
    let finished = false
    // Only once the chunk is written does the state move past what was read.
    let after = state.after
    while (rows.length < CHUNK_ROWS && more()) {
      const { results } = await db.prepare(`SELECT rowid AS _rowid_, * FROM ${quote(table)} WHERE rowid > ? ORDER BY rowid LIMIT ?`).bind(after, PAGE_ROWS).all<Record<string, unknown>>()
      for (const row of results) {
        // The backup's own progress would make a restored install think one is running.
        if (table === 'settings' && row.key === STATE_KEY) continue
        for (const column of omit) delete row[column]
        rows.push(row)
      }
      if (results.length > 0) after = results.at(-1)!._rowid_ as number
      if (results.length < PAGE_ROWS) {
        finished = true
        break
      }
    }
    // What was read is written before the state moves past it.
    const count = (state.counts[table] ??= { rows: 0, chunks: 0, chunkRows: [], files: [] })
    // A backup the version before began kept neither list: its chunks so far have the plain names, and their rows
    // weren't counted one by one, so this table goes without `chunkRows` rather than with a list that starts late.
    if (!count.files && count.chunks > 0) count.files = Array.from({ length: count.chunks }, (_, seq) => plainChunkFile(seq))
    if (rows.length > 0) {
      const body = await gzip(rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
      // Its own file name: an upload that lands late, after another run took over, overwrites nothing.
      const file = chunkFile(count.chunks, state.leaseToken ?? randomId())
      await withTimeout(provider.put(chunkKey(state.id, table, count.chunks, file), body, { contentType: 'application/gzip' }), PUT_TIMEOUT_MS, 'Writing a backup chunk')
      count.rows += rows.length
      if (count.chunkRows) count.chunkRows.push(rows.length)
      else if (count.chunks === 0) count.chunkRows = [rows.length]
      ;(count.files ??= []).push(file)
      count.chunks++
      state.bytes += body.byteLength
    }
    state.after = after
    if (finished) {
      state.table++
      state.after = 0
    }
    // Written: what failed before is history.
    state.failures = 0
    await saveState(db, state, was)
  }
  return true
}

async function finish(env: DamBindings, provider: StorageProvider, state: BackupState): Promise<void> {
  const db = env.DB
  const { results: migrations } = await db.prepare('SELECT name FROM _migrations ORDER BY name').all<{ name: string }>()
  const finishedAt = nowIso()
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: 1,
    id: state.id,
    startedAt: state.startedAt,
    finishedAt,
    migrations: migrations.map((m) => m.name),
    tables: state.tables.map((name) => ({ name, ...(state.counts[name] ?? { rows: 0, chunks: 0, chunkRows: [], files: [] }), omittedColumns: state.omit[name] ?? [] })),
    omittedTables: OMITTED_TABLES,
  }
  await provider.put(manifestKey(state.id), JSON.stringify(manifest, null, 2), { contentType: 'application/json' })
  const rows = manifest.tables.reduce((n, t) => n + t.rows, 0)
  const chunks = manifest.tables.reduce((n, t) => n + t.chunks, 0)
  const [gone] = await db.batch([
    db.prepare("DELETE FROM settings WHERE key = ? AND json_extract(value, '$.leaseToken') = ?").bind(STATE_KEY, state.leaseToken),
    db
      .prepare(
        `UPDATE backups SET status = 'done', finished_at = ?, rows = ?, bytes = ?, chunks = ?
         WHERE id = ? AND NOT EXISTS (SELECT 1 FROM settings WHERE key = ? AND json_extract(value, '$.id') = ?)`,
      )
      .bind(finishedAt, rows, state.bytes, chunks, state.id, STATE_KEY, state.id),
  ])
  if (gone!.meta.changes !== 1) throw new LeaseLost()
  await logActivity(db, { userId: null, action: 'backup.done', targetType: 'backup', targetId: state.id, details: { rows, bytes: state.bytes } })
}

async function fail(db: D1Database, state: BackupState, message: string): Promise<void> {
  const [gone] = await db.batch([
    db.prepare("DELETE FROM settings WHERE key = ? AND json_extract(value, '$.leaseToken') = ?").bind(STATE_KEY, state.leaseToken),
    db
      .prepare(
        `UPDATE backups SET status = 'failed', finished_at = ?, error = ?
         WHERE id = ? AND NOT EXISTS (SELECT 1 FROM settings WHERE key = ? AND json_extract(value, '$.id') = ?)`,
      )
      .bind(nowIso(), message, state.id, STATE_KEY, state.id),
  ])
  if (gone!.meta.changes !== 1) return
  await logActivity(db, { userId: null, action: 'backup.failed', targetType: 'backup', targetId: state.id, details: { error: message } })
}

/** Delete one old backup's files, a page at a time; the newest finished backup is always kept. */
async function prune(env: DamBindings, config: BackupConfig): Promise<number> {
  const db = env.DB
  const cutoff = new Date(Date.now() - config.keepDays * 86_400_000).toISOString()
  const old = await db
    .prepare(
      `SELECT id, connection_id FROM backups
       WHERE (status = 'deleting' OR (status IN ('done', 'failed') AND started_at < ?))
         AND id IS NOT (SELECT id FROM backups WHERE status = 'done' ORDER BY started_at DESC LIMIT 1)
       ORDER BY started_at LIMIT 1`,
    )
    .bind(cutoff)
    .first<{ id: string; connection_id: string }>()
  if (!old) return 0
  const connection = await getConnection(db, old.connection_id)
  if (!connection || connection.provider === 'nas') {
    await db.prepare('DELETE FROM backups WHERE id = ?').bind(old.id).run()
    return 0
  }
  const provider = underPrefix(providerFor(env, connection), connection.prefix)
  // The manifest goes first, so a half-deleted backup never looks finished.
  await db.prepare("UPDATE backups SET status = 'deleting' WHERE id = ?").bind(old.id).run()
  await provider.delete(manifestKey(old.id))
  const { objects } = await provider.list(backupRoot(old.id))
  const batch = objects.slice(0, PRUNE_PER_RUN)
  for (const object of batch) await provider.delete(object.key)
  if (objects.length <= PRUNE_PER_RUN) await db.prepare('DELETE FROM backups WHERE id = ?').bind(old.id).run()
  return batch.length
}

export interface BackupStep {
  started: string | null
  copied: boolean
  finished: string | null
  pruned: number
}

/** The sweep's backup stage: carry on a backup, start the daily one when due, or tidy old ones. */
export async function backupStep(env: DamBindings, more: () => boolean): Promise<BackupStep> {
  const db = env.DB
  const step: BackupStep = { started: null, copied: false, finished: null, pruned: 0 }
  const row = await db
    .prepare(
      `SELECT (SELECT value FROM settings WHERE key = ?) AS config, (SELECT value FROM settings WHERE key = ?) AS state,
              (SELECT MAX(started_at) FROM backups) AS last, EXISTS (SELECT 1 FROM backups WHERE status = 'running') AS running`,
    )
    .bind(CONFIG_KEY, STATE_KEY)
    .first<{ config: string | null; state: string | null; last: string | null; running: number }>()
  const config = parseConfig(row?.config)

  if (!row?.state) {
    // A backup marked running with no progress stopped before it finished (from before backups had a lease).
    if (row?.running) await db
      .prepare(
        `UPDATE backups SET status = 'failed', finished_at = ?, error = 'Stopped before it finished.'
         WHERE status = 'running' AND NOT EXISTS (SELECT 1 FROM settings WHERE key = ? AND json_extract(value, '$.id') = backups.id)`,
      )
      .bind(nowIso(), STATE_KEY)
      .run()
    if (!backupDue(config, row?.last ?? null)) {
      step.pruned = await prune(env, config)
      return step
    }
    const started = await startBackup(env, config.connectionId!).catch((error) => {
      console.warn('[backup] could not start', error instanceof Error ? error.message : error)
      return null
    })
    if (!started) return step
    step.started = started.id
  }

  // This run's turn, unless an overlapping one has it.
  const token = randomId()
  const state = await takeLease(db, token)
  if (!state) return step
  try {
    const { provider } = await destination(env, state.connectionId)
    step.copied = true
    if (await copyTables(db, provider, state, more)) {
      await finish(env, provider, state)
      step.finished = state.id
    } else {
      await saveState(db, state, { table: state.table, after: state.after }, true)
    }
  } catch (error) {
    if (error instanceof LeaseLost) return step
    const message = error instanceof Error ? error.message : String(error)
    // Failures in a row: one that comes after a written chunk starts the count again.
    state.failures++
    console.warn('[backup] run failed', state.id, message)
    if (state.failures >= MAX_FAILURES) await fail(db, state, message)
    else {
      // Only the count and the lease: the progress stays as last saved.
      await db
        .prepare("UPDATE settings SET value = json_set(value, '$.failures', ?, '$.leaseUntil', NULL), updated_at = ? WHERE key = ? AND json_extract(value, '$.leaseToken') = ?")
        .bind(state.failures, nowIso(), STATE_KEY, token)
        .run()
        .catch(() => {})
    }
  }
  return step
}

/** A finished backup's manifest, or null if it has none (unfinished, or gone). */
export async function readManifest(provider: StorageProvider, id: string): Promise<BackupManifest | null> {
  const object = await provider.get(manifestKey(id))
  if (!object) return null
  const manifest = JSON.parse(await new Response(object.body).text()) as BackupManifest
  return manifest.format === BACKUP_FORMAT ? manifest : null
}

/** One chunk of a backup, as rows (each with its `_rowid_`). `file` is its name from the manifest, if it has one. */
export async function readChunk(provider: StorageProvider, id: string, table: string, seq: number, file?: string): Promise<Record<string, unknown>[]> {
  const object = await provider.get(chunkKey(id, table, seq, file))
  if (!object) throw new Error(`Backup ${id} is missing ${table} chunk ${seq}.`)
  // The stream types disagree on chunk types (BufferSource vs Uint8Array); the bytes are the same.
  const gunzip = new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  const text = await new Response(object.body.pipeThrough(gunzip)).text()
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
}

/**
 * Load a finished backup into a fresh database in one go, the way a restore does (catalog/restore-load.ts).
 * For checking backups in the tests; a real restore goes a part at a time (catalog/restore.ts).
 */
export async function importBackup(db: D1Database, provider: StorageProvider, id: string): Promise<{ rows: number }> {
  const manifest = await readManifest(provider, id)
  if (!manifest) throw new Error(`Backup ${id} has no manifest: it never finished, or it's gone.`)
  const names = manifest.tables.map((t) => t.name)
  const keys = await readKeys(db, names)
  const info = await db.batch(names.map((name) => db.prepare('SELECT name FROM pragma_table_info(?)').bind(name)))
  const columns = new Map(names.map((name, i) => [name, (info[i]!.results as { name: string }[]).map((c) => c.name)]))
  const byName = new Map(manifest.tables.map((t) => [t.name, t]))
  let total = 0
  for (const name of orderTables(names, (n) => keys.get(n)!.map((k) => k.parent))) {
    const table = byName.get(name)!
    const load = { name, columns: columns.get(name)! }
    if (load.columns.length === 0) continue
    const self = selfKey(name, keys.get(name)!)
    for (let pass = 0, before = -1; ; pass++) {
      for (let seq = 0; seq < table.chunks; seq++) {
        let rows = await readChunk(provider, id, name, seq, table.files?.[seq])
        if (self) rows = parentsFirst(rows, self)
        for (let offset = 0; offset < rows.length; ) {
          const group = nextGroup(rows, offset)
          // Exactly as backed up: this checks the backup, not what a restore changes on the way in.
          await loadStatement(db, load, keys.get(name)!, group, undefined, { overrides: false }).run()
          offset += group.length
          if (pass === 0) total += group.length
        }
      }
      if (!self) break
      const now = (await db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).first<{ n: number }>())!.n
      if (now === before || now >= table.rows) break
      before = now
    }
  }
  return { rows: total }
}

/** Rows per statement at most (re-exported for older callers). */
export const INSERT_ROWS = GROUP_ROWS
