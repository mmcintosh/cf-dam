/**
 * What the agent knows between runs, in SQLite under /data: which files it has sent, as what, and
 * what they looked like then. A restart picks up where it stopped; an unchanged file costs nothing.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface FileRow {
  root_id: string
  path: string
  size: number
  mtime_ms: number
  quick_hash: string | null
  asset_id: string | null
  /** 'resend': cf-dam lost its previews, so the next scan sends it again. */
  status: 'done' | 'error' | 'resend'
  error: string | null
  attempts: number
  /** 1: sent with its thumb only (a big first scan); its preview follows at the end of a scan. */
  preview_later: number
}

/** Recorded against a file the agent was reading when it died (killed for memory, most likely). */
export const STOPPED_READING = 'The agent stopped while reading this file (out of memory?).'

/** Archiving gives up on a file after this many failed tries (until the next agent version). */
export const MAX_ARCHIVE_ATTEMPTS = 3
/** A file the scan couldn't read is left alone after this many tries (until a new helper version). */
export const MAX_SCAN_ATTEMPTS = 3
/** A file given up on is tried again after this long (and again a week after each time it's given up). */
export const ARCHIVE_RETRY_MS = 7 * 24 * 60 * 60_000
/** Clipped before they go in the status cf-dam keeps (8,000 characters for all of it). */
const clip = (text: string | null, n = 200) => (text && text.length > n ? `${text.slice(0, n - 1)}…` : text)

export interface ArchiveCandidate {
  root_id: string
  path: string
  size: number
  mtime_ms: number
  quick_hash: string
  asset_id: string
}

export interface ArchivePart {
  partNumber: number
  etag: string
  checksum: string
}

export interface ArchiveCounts {
  /** Files whose bytes changed without their date moving, waiting for a person to decide. */
  held: { files: number; first: { path: string; reason: string } | null }
  gaveUp: { files: number; bytes: number }
  cantRead: { new: number; archived: number }
  notReadYet: number
  /** Files archived, and how many of them changed or became unreadable in the last day. */
  archivedFiles: number
  changedArchived24h: number
  cantReadArchived24h: number
  lastGaveUp: { path: string; error: string | null; at: string | null } | null
}

export interface ArchiveUpload {
  asset_id: string
  root_id: string
  path: string
  upload_id: string
  size: number
  quick_hash: string
  part_size: number
  part_count: number
  parts: ArchivePart[]
  started_at: string
}

export interface Credentials {
  url: string
  apiKey: string
  sourceId: string
}

export class State {
  readonly db: DatabaseSync
  private readonly credentialsPath: string

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.db = new DatabaseSync(join(dataDir, 'state.db'))
    this.credentialsPath = join(dataDir, 'credentials.json')
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS files (
        root_id    TEXT NOT NULL,
        path       TEXT NOT NULL,
        size       INTEGER NOT NULL,
        mtime_ms   INTEGER NOT NULL,
        quick_hash TEXT,
        asset_id   TEXT,
        status     TEXT NOT NULL,
        error      TEXT,
        attempts   INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (root_id, path)
      );
      CREATE INDEX IF NOT EXISTS files_hash ON files (root_id, quick_hash);
      CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      -- Archiving (archive.ts): uploads under way, part by part, so a stop resumes mid-file.
      -- Older photos cf-dam asked this helper to look at for faces (PLAN-FN2-v2): rendered again from the file.
      CREATE TABLE IF NOT EXISTS faces_todo (
        asset_id TEXT PRIMARY KEY,
        asked_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS archive_uploads (
        asset_id   TEXT PRIMARY KEY,
        root_id    TEXT NOT NULL,
        path       TEXT NOT NULL,
        upload_id  TEXT NOT NULL,
        size       INTEGER NOT NULL,
        quick_hash TEXT NOT NULL,
        part_size  INTEGER NOT NULL,
        part_count INTEGER NOT NULL,
        parts      TEXT NOT NULL DEFAULT '[]',
        started_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reading (
        root_id    TEXT NOT NULL,
        path       TEXT NOT NULL,
        size       INTEGER NOT NULL,
        mtime_ms   INTEGER NOT NULL,
        quick_hash TEXT,
        PRIMARY KEY (root_id, path)
      );
    `)
    // Archiving: the fingerprint of the file as last archived (none: never), and failed tries.
    const columns = (this.db.prepare('PRAGMA table_info(files)').all() as { name: string }[]).map((c) => c.name)
    if (!columns.includes('archived_hash')) this.db.exec('ALTER TABLE files ADD COLUMN archived_hash TEXT')
    if (!columns.includes('archive_attempts')) this.db.exec('ALTER TABLE files ADD COLUMN archive_attempts INTEGER NOT NULL DEFAULT 0')
    // Why the last try failed, and how many times the bucket ended an upload of it before it finished.
    if (!columns.includes('archive_error')) this.db.exec('ALTER TABLE files ADD COLUMN archive_error TEXT')
    if (!columns.includes('archive_restarts')) this.db.exec('ALTER TABLE files ADD COLUMN archive_restarts INTEGER NOT NULL DEFAULT 0')
    // When a file given up on is tried again by itself (ms; set each time it's given up).
    if (!columns.includes('archive_retry_at')) this.db.exec('ALTER TABLE files ADD COLUMN archive_retry_at INTEGER')
    // Held for a person to decide: its bytes changed without its date moving (A.6). "kept: …" once they chose the copy
    // already in the bucket.
    if (!columns.includes('archive_held')) this.db.exec('ALTER TABLE files ADD COLUMN archive_held TEXT')
    this.db.exec(`CREATE INDEX IF NOT EXISTS files_archive_gave_up ON files (root_id, path) WHERE archive_attempts >= ${MAX_ARCHIVE_ATTEMPTS}`)
    if (!columns.includes('preview_later')) this.db.exec('ALTER TABLE files ADD COLUMN preview_later INTEGER NOT NULL DEFAULT 0')
    this.db.exec('CREATE INDEX IF NOT EXISTS files_preview_later ON files (root_id, path) WHERE preview_later = 1')
    // What's left to archive, without reading every file's row (a million, for a big archive).
    this.db.exec('CREATE INDEX IF NOT EXISTS files_to_archive ON files (root_id, path) WHERE archived_hash IS NOT quick_hash')
    // Files still marked as being read: the agent died reading them. Each counts as a failed try, so
    // a file that kills it every time is left alone after three, instead of the same batch forever.
    const stopped = this.db.prepare('SELECT * FROM reading').all() as unknown as { root_id: string; path: string; size: number; mtime_ms: number; quick_hash: string | null }[]
    for (const r of stopped) this.failed(r.root_id, r.path, { size: r.size, mtimeMs: r.mtime_ms, quickHash: r.quick_hash }, STOPPED_READING)
    this.db.exec('DELETE FROM reading')
    // Which source the file list belongs to (state from before this was recorded: the saved one's).
    const saved = this.readCredentials()
    if (saved?.sourceId) this.db.prepare('INSERT OR IGNORE INTO meta (name, value) VALUES (?, ?)').run('source_id', saved.sourceId)
  }

  files(rootId: string): Map<string, FileRow> {
    const rows = this.db.prepare('SELECT * FROM files WHERE root_id = ?').all(rootId) as unknown as FileRow[]
    return new Map(rows.map((r) => [r.path, r]))
  }

  done(rootId: string, path: string, f: { size: number; mtimeMs: number; quickHash: string; assetId: string; previewLater?: boolean }): void {
    this.db
      .prepare(
        `INSERT INTO files (root_id, path, size, mtime_ms, quick_hash, asset_id, status, error, attempts, preview_later, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'done', NULL, 0, ?, ?)
         ON CONFLICT (root_id, path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, quick_hash = excluded.quick_hash,
           asset_id = excluded.asset_id, status = 'done', error = NULL, attempts = 0, preview_later = excluded.preview_later, updated_at = excluded.updated_at,
           -- A file that changed is a new file to archive: whatever went wrong with the old one is history.
           archive_attempts = CASE WHEN files.quick_hash IS excluded.quick_hash THEN files.archive_attempts ELSE 0 END,
           archive_restarts = CASE WHEN files.quick_hash IS excluded.quick_hash THEN files.archive_restarts ELSE 0 END,
           archive_error = CASE WHEN files.quick_hash IS excluded.quick_hash THEN files.archive_error ELSE NULL END,
           archive_retry_at = CASE WHEN files.quick_hash IS excluded.quick_hash THEN files.archive_retry_at ELSE NULL END,
           archive_held = CASE WHEN files.quick_hash IS excluded.quick_hash THEN files.archive_held ELSE NULL END`,
      )
      .run(rootId, path, f.size, Math.floor(f.mtimeMs), f.quickHash, f.assetId, f.previewLater ? 1 : 0, new Date().toISOString())
  }

  /** Files of a folder sent with their thumb only, whose previews are still to go, a page at a time. */
  previewsLater(rootId: string, limit: number): FileRow[] {
    return this.db.prepare("SELECT * FROM files WHERE root_id = ? AND preview_later = 1 AND status = 'done' ORDER BY path LIMIT ?").all(rootId, limit) as unknown as FileRow[]
  }

  /** Photos cf-dam asked about for faces; ones already waiting keep their place. */
  askFaces(assetIds: string[]): number {
    if (assetIds.length === 0) return 0
    const now = new Date().toISOString()
    return Number(this.db.prepare('INSERT OR IGNORE INTO faces_todo (asset_id, asked_at) SELECT value, ? FROM json_each(?)').run(now, JSON.stringify(assetIds)).changes)
  }

  /** The next photos to look at for faces, with the file each one is. */
  facesTodo(limit: number): { asset_id: string; file: FileRow | null }[] {
    const rows = this.db.prepare('SELECT asset_id FROM faces_todo ORDER BY asked_at LIMIT ?').all(limit) as { asset_id: string }[]
    const file = this.db.prepare("SELECT * FROM files WHERE asset_id = ? AND status = 'done' LIMIT 1")
    return rows.map((r) => ({ asset_id: r.asset_id, file: (file.get(r.asset_id) as unknown as FileRow | undefined) ?? null }))
  }

  facesDone(assetId: string): void {
    this.db.prepare('DELETE FROM faces_todo WHERE asset_id = ?').run(assetId)
  }

  /** Faces paused: forget what was asked (cf-dam hands it out again when they're back on). */
  clearFaces(): void {
    this.db.prepare('DELETE FROM faces_todo').run()
  }

  /** Its preview went (or can't, and won't be tried again until the file changes). */
  previewSent(rootId: string, path: string): void {
    this.db.prepare('UPDATE files SET preview_later = 0 WHERE root_id = ? AND path = ?').run(rootId, path)
  }

  failed(rootId: string, path: string, f: { size: number; mtimeMs: number; quickHash: string | null }, error: string): void {
    this.db
      .prepare(
        `INSERT INTO files (root_id, path, size, mtime_ms, quick_hash, asset_id, status, error, attempts, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'error', ?, 1, ?)
         ON CONFLICT (root_id, path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, quick_hash = excluded.quick_hash,
           status = 'error', error = excluded.error, attempts = files.attempts + 1, updated_at = excluded.updated_at`,
      )
      .run(rootId, path, f.size, Math.floor(f.mtimeMs), f.quickHash, error.slice(0, 500), new Date().toISOString())
  }

  /** Around reading and rendering a file: the marks a crash leaves behind (see the constructor). */
  reading(rootId: string, path: string, f: { size: number; mtimeMs: number; quickHash: string }): void {
    this.db.prepare('INSERT OR REPLACE INTO reading (root_id, path, size, mtime_ms, quick_hash) VALUES (?, ?, ?, ?, ?)').run(rootId, path, f.size, Math.floor(f.mtimeMs), f.quickHash)
  }

  read(rootId: string, path: string): void {
    this.db.prepare('DELETE FROM reading WHERE root_id = ? AND path = ?').run(rootId, path)
  }

  /** Stopping on purpose (SIGTERM): whatever was being read wasn't at fault. */
  clearReading(): void {
    this.db.exec('DELETE FROM reading')
  }

  /**
   * A new agent version may read what the last one couldn't (HEIC, say): files given up on get their
   * three tries again.
   */
  newVersion(version: string): void {
    const was = (this.db.prepare("SELECT value FROM meta WHERE name = 'agent_version'").get() as { value: string } | undefined)?.value
    if (was === version) return
    this.db.exec("UPDATE files SET attempts = 0 WHERE status = 'error'")
    this.db.exec('UPDATE files SET archive_attempts = 0')
    this.db.prepare("INSERT INTO meta (name, value) VALUES ('agent_version', ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value").run(version)
  }

  /**
   * A folder that was reachable but showed nothing, where files were known: one more such scan in a
   * row. Returns how many there have been and since when.
   */
  sawEmpty(rootId: string, now: number): { scans: number; since: number } {
    const was = this.metaJson<{ scans: number; since: number }>(`empty:${rootId}`)
    const next = { scans: (was?.scans ?? 0) + 1, since: was?.since ?? now }
    this.setMeta(`empty:${rootId}`, JSON.stringify(next))
    return next
  }

  /** The folder showed files (or has none to lose): the count of empty scans starts over. */
  sawFiles(rootId: string, patterns: string): void {
    this.db.prepare('DELETE FROM meta WHERE name = ?').run(`empty:${rootId}`)
    this.setMeta(`patterns:${rootId}`, patterns)
  }

  /** The include and exclude patterns of the folder's last scan that found files (null: none recorded). */
  patterns(rootId: string): string | null {
    return (this.db.prepare('SELECT value FROM meta WHERE name = ?').get(`patterns:${rootId}`) as { value: string } | undefined)?.value ?? null
  }

  forget(rootId: string, paths: string[]): void {
    const stmt = this.db.prepare('DELETE FROM files WHERE root_id = ? AND path = ?')
    for (const p of paths) stmt.run(rootId, p)
  }

  /** Roots no longer configured: forget their files (cf-dam already marked them missing). */
  keepRoots(rootIds: string[]): void {
    if (rootIds.length === 0) return
    this.db.prepare(`DELETE FROM files WHERE root_id NOT IN (${rootIds.map(() => '?').join(',')})`).run(...rootIds)
    this.db
      .prepare(`DELETE FROM meta WHERE (name LIKE 'empty:%' OR name LIKE 'patterns:%') AND substr(name, instr(name, ':') + 1) NOT IN (SELECT value FROM json_each(?))`)
      .run(JSON.stringify(rootIds))
  }

  // ── Archiving ──────────────────────────────────────────────────────────────

  /**
   * Files to archive, after `after` (root, path order: oldest folders first in a dated archive): sent to
   * cf-dam, unchanged since `stableBefore` (ms), not archived as they are now, and not given up on.
   */
  archiveCandidates(after: { rootId: string; path: string } | null, stableBefore: number, limit: number): ArchiveCandidate[] {
    return this.db
      .prepare(
        `SELECT root_id, path, size, mtime_ms, quick_hash, asset_id FROM files
         WHERE status = 'done' AND asset_id IS NOT NULL AND quick_hash IS NOT NULL AND archived_hash IS NOT quick_hash
           AND (archive_attempts < ? OR archive_retry_at <= ?) AND archive_held IS NULL AND mtime_ms < ? AND (root_id, path) > (?, ?)
         ORDER BY root_id, path LIMIT ?`,
      )
      .all(MAX_ARCHIVE_ATTEMPTS, Date.now(), stableBefore, after?.rootId ?? '', after?.path ?? '', limit) as unknown as ArchiveCandidate[]
  }

  /** How much is left to archive (for progress and the estimated finish). */
  archiveLeft(stableBefore: number): { files: number; bytes: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM files
         WHERE status = 'done' AND asset_id IS NOT NULL AND quick_hash IS NOT NULL AND archived_hash IS NOT quick_hash
           AND (archive_attempts < ? OR archive_retry_at <= ?) AND archive_held IS NULL AND mtime_ms < ?`,
      )
      .get(MAX_ARCHIVE_ATTEMPTS, Date.now(), stableBefore) as { files: number; bytes: number }
    return { files: row.files, bytes: Number(row.bytes) }
  }

  archived(rootId: string, path: string, quickHash: string): void {
    this.db
      .prepare('UPDATE files SET archived_hash = ?, archive_attempts = 0, archive_error = NULL, archive_restarts = 0, archive_retry_at = NULL, archive_held = NULL WHERE root_id = ? AND path = ?')
      .run(quickHash, rootId, path)
  }

  /** One failed try, and why. */
  archiveFailed(rootId: string, path: string, reason: string): void {
    // Given up on with this try (or tried again after a week and failed): tried again a week from now.
    this.db
      .prepare(
        `UPDATE files SET archive_attempts = archive_attempts + 1, archive_error = ?,
           archive_retry_at = CASE WHEN archive_attempts + 1 >= ? THEN ? ELSE NULL END
         WHERE root_id = ? AND path = ?`,
      )
      .run(reason.slice(0, 500), MAX_ARCHIVE_ATTEMPTS, Date.now() + ARCHIVE_RETRY_MS, rootId, path)
  }

  /** Given up on at once (no more tries), and why. */
  archiveGiveUp(rootId: string, path: string, reason: string): void {
    this.db
      .prepare('UPDATE files SET archive_attempts = MAX(archive_attempts, ?), archive_error = ?, archive_retry_at = ? WHERE root_id = ? AND path = ?')
      .run(MAX_ARCHIVE_ATTEMPTS, reason.slice(0, 500), Date.now() + ARCHIVE_RETRY_MS, rootId, path)
  }

  /** Hold a file for a person to decide (no try counted): its bytes changed without its date moving. */
  archiveHold(rootId: string, path: string, reason: string): void {
    this.db.prepare('UPDATE files SET archive_held = ? WHERE root_id = ? AND path = ?').run(reason.slice(0, 200), rootId, path)
  }

  /**
   * A person's choice for the files held: archive them as they are now, or keep the copy already in the bucket.
   * Returns the photos whose unfinished uploads to give up.
   */
  archiveHeldChoice(choice: 'archive' | 'keep'): string[] {
    const held = this.db.prepare("SELECT asset_id FROM files WHERE archive_held IS NOT NULL AND archive_held NOT LIKE 'kept:%' AND asset_id IS NOT NULL").all() as { asset_id: string }[]
    if (choice === 'archive') this.db.exec("UPDATE files SET archive_held = NULL WHERE archive_held IS NOT NULL AND archive_held NOT LIKE 'kept:%'")
    else this.db.exec("UPDATE files SET archive_held = 'kept: ' || archive_held WHERE archive_held IS NOT NULL AND archive_held NOT LIKE 'kept:%'")
    return held.map((h) => h.asset_id)
  }

  /** "Try them again": every file given up on gets its tries back. */
  archiveRetryAll(): number {
    return Number(
      this.db.prepare('UPDATE files SET archive_attempts = 0, archive_restarts = 0, archive_retry_at = NULL WHERE archive_attempts >= ?').run(MAX_ARCHIVE_ATTEMPTS).changes,
    )
  }

  /**
   * What archiving can't do, for the panel and the alerts: files given up on (until their weekly retry), files that
   * couldn't be read and so have no photo to archive, archived files that can no longer be read, and files still
   * within the scan's tries.
   */
  archiveCounts(now = Date.now()): ArchiveCounts {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'done' AND archive_attempts >= ? AND (archive_retry_at IS NULL OR archive_retry_at > ?)) AS gave_up,
           COALESCE(SUM(size) FILTER (WHERE status = 'done' AND archive_attempts >= ? AND (archive_retry_at IS NULL OR archive_retry_at > ?)), 0) AS gave_up_bytes,
           COUNT(*) FILTER (WHERE status = 'error' AND attempts >= ? AND archived_hash IS NULL) AS cant_read_new,
           COUNT(*) FILTER (WHERE status = 'error' AND attempts >= ? AND archived_hash IS NOT NULL) AS cant_read_archived,
           COUNT(*) FILTER (WHERE (status = 'error' AND attempts < ?) OR status = 'resend') AS not_read_yet,
           COUNT(*) FILTER (WHERE archive_held IS NOT NULL AND archive_held NOT LIKE 'kept:%') AS held,
           -- Many archived files changing (or turning unreadable) in a day is how ransomware, a bad sync or a failing
           -- disk looks: counted for cf-dam's alert. A scan touches a file's row only when the file changed.
           COUNT(*) FILTER (WHERE archived_hash IS NOT NULL) AS archived,
           COUNT(*) FILTER (WHERE status = 'done' AND archived_hash IS NOT NULL AND archived_hash IS NOT quick_hash AND updated_at > ?) AS changed_24h,
           COUNT(*) FILTER (WHERE status = 'error' AND archived_hash IS NOT NULL AND updated_at > ?) AS cant_read_24h
         FROM files`,
      )
      .get(
        MAX_ARCHIVE_ATTEMPTS, now, MAX_ARCHIVE_ATTEMPTS, now, MAX_SCAN_ATTEMPTS, MAX_SCAN_ATTEMPTS, MAX_SCAN_ATTEMPTS,
        new Date(now - 86_400_000).toISOString(), new Date(now - 86_400_000).toISOString(),
      ) as Record<string, number>
    const last = this.db
      .prepare(`SELECT path, archive_error, archive_retry_at FROM files WHERE archive_attempts >= ? AND status = 'done' ORDER BY archive_retry_at DESC LIMIT 1`)
      .get(MAX_ARCHIVE_ATTEMPTS) as { path: string; archive_error: string | null; archive_retry_at: number | null } | undefined
    const firstHeld = row.held
      ? (this.db.prepare("SELECT path, archive_held FROM files WHERE archive_held IS NOT NULL AND archive_held NOT LIKE 'kept:%' ORDER BY path LIMIT 1").get() as { path: string; archive_held: string })
      : null
    return {
      held: { files: row.held ?? 0, first: firstHeld ? { path: clip(firstHeld.path)!, reason: firstHeld.archive_held } : null },
      gaveUp: { files: row.gave_up ?? 0, bytes: Number(row.gave_up_bytes ?? 0) },
      cantRead: { new: row.cant_read_new ?? 0, archived: row.cant_read_archived ?? 0 },
      notReadYet: row.not_read_yet ?? 0,
      archivedFiles: row.archived ?? 0,
      changedArchived24h: row.changed_24h ?? 0,
      cantReadArchived24h: row.cant_read_24h ?? 0,
      lastGaveUp:
        last && row.gave_up
          ? { path: clip(last.path)!, error: clip(last.archive_error), at: last.archive_retry_at ? new Date(last.archive_retry_at - ARCHIVE_RETRY_MS).toISOString() : null }
          : null,
    }
  }

  /** The bucket ended an upload of this file before it finished: how many times now. */
  archiveRestarted(rootId: string, path: string): number {
    const row = this.db
      .prepare('UPDATE files SET archive_restarts = archive_restarts + 1 WHERE root_id = ? AND path = ? RETURNING archive_restarts')
      .get(rootId, path) as { archive_restarts: number } | undefined
    return row?.archive_restarts ?? 0
  }

  /** Why a file's last try failed (tests, and the panel later). */
  archiveError(rootId: string, path: string): { attempts: number; error: string | null; restarts: number } | null {
    const row = this.db.prepare('SELECT archive_attempts AS attempts, archive_error AS error, archive_restarts AS restarts FROM files WHERE root_id = ? AND path = ?').get(rootId, path) as
      | { attempts: number; error: string | null; restarts: number }
      | undefined
    return row ?? null
  }

  upload(assetId: string): ArchiveUpload | null {
    const row = this.db.prepare('SELECT * FROM archive_uploads WHERE asset_id = ?').get(assetId) as (Omit<ArchiveUpload, 'parts'> & { parts: string }) | undefined
    return row ? { ...row, parts: JSON.parse(row.parts) as ArchivePart[] } : null
  }

  saveUpload(u: Omit<ArchiveUpload, 'parts'>): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO archive_uploads (asset_id, root_id, path, upload_id, size, quick_hash, part_size, part_count, parts, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
      )
      .run(u.asset_id, u.root_id, u.path, u.upload_id, u.size, u.quick_hash, u.part_size, u.part_count, u.started_at)
  }

  /** One part safely in the bucket. */
  savePart(assetId: string, part: ArchivePart): void {
    this.db
      .prepare("UPDATE archive_uploads SET parts = json_insert(parts, '$[#]', json(?)) WHERE asset_id = ?")
      .run(JSON.stringify(part), assetId)
  }

  dropUpload(assetId: string): void {
    this.db.prepare('DELETE FROM archive_uploads WHERE asset_id = ?').run(assetId)
  }

  counts(): { done: number; error: number; previewsLater: number } {
    const row = this.db.prepare("SELECT SUM(status = 'done') AS done, SUM(status = 'error') AS error, SUM(preview_later = 1 AND status = 'done') AS later FROM files").get() as {
      done: number | null
      error: number | null
      later: number | null
    }
    return { done: row.done ?? 0, error: row.error ?? 0, previewsLater: row.later ?? 0 }
  }

  private metaJson<T>(name: string): T | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE name = ?').get(name) as { value: string } | undefined
    try {
      return row ? (JSON.parse(row.value) as T) : null
    } catch {
      return null
    }
  }

  private setMeta(name: string, value: string): void {
    this.db.prepare('INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value').run(name, value)
  }

  private readCredentials(): Partial<Credentials> | null {
    if (!existsSync(this.credentialsPath)) return null
    try {
      return JSON.parse(readFileSync(this.credentialsPath, 'utf8')) as Partial<Credentials>
    } catch {
      return null
    }
  }

  credentials(url: string): Credentials | null {
    const c = this.readCredentials()
    // Credentials belong to one cf-dam; pointing the agent elsewhere means pairing again.
    return c && c.url === url && c.apiKey && c.sourceId ? (c as Credentials) : null
  }

  /**
   * A new pairing. The file list says what was sent to one source; paired again as the same source it
   * still holds, as a new one (a new source in cf-dam, with its own photos) it starts afresh.
   */
  saveCredentials(c: Credentials): void {
    const was = (this.db.prepare("SELECT value FROM meta WHERE name = 'source_id'").get() as { value: string } | undefined)?.value
    // A new source: its uploads (made for the old one's photos) go with the file list.
    if (was !== c.sourceId) this.db.exec('DELETE FROM files; DELETE FROM archive_uploads')
    this.db.prepare("INSERT INTO meta (name, value) VALUES ('source_id', ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value").run(c.sourceId)
    writeFileSync(this.credentialsPath, JSON.stringify(c), { mode: 0o600 })
    chmodSync(this.credentialsPath, 0o600)
  }

  /** cf-dam has lost these photos' previews: the next scan sends their files again. Returns how many it knows. */
  resend(assetIds: string[]): number {
    if (assetIds.length === 0) return 0
    return Number(this.db.prepare("UPDATE files SET status = 'resend' WHERE status = 'done' AND asset_id IN (SELECT value FROM json_each(?))").run(JSON.stringify(assetIds)).changes)
  }

  /** The entry this agent last had in cf-dam, if any: offered back when it pairs again. */
  previousSourceId(): string | null {
    return (this.db.prepare("SELECT value FROM meta WHERE name = 'source_id'").get() as { value: string } | undefined)?.value ?? null
  }

  /** The key no longer works. The file list stays until a new pairing says whose it is. */
  clearCredentials(): void {
    writeFileSync(this.credentialsPath, '{}', { mode: 0o600 })
  }
}
