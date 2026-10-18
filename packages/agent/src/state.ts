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
  status: 'done' | 'error'
  error: string | null
  attempts: number
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
    `)
    // Which source the file list belongs to (state from before this was recorded: the saved one's).
    const saved = this.readCredentials()
    if (saved?.sourceId) this.db.prepare('INSERT OR IGNORE INTO meta (name, value) VALUES (?, ?)').run('source_id', saved.sourceId)
  }

  files(rootId: string): Map<string, FileRow> {
    const rows = this.db.prepare('SELECT * FROM files WHERE root_id = ?').all(rootId) as unknown as FileRow[]
    return new Map(rows.map((r) => [r.path, r]))
  }

  done(rootId: string, path: string, f: { size: number; mtimeMs: number; quickHash: string; assetId: string }): void {
    this.db
      .prepare(
        `INSERT INTO files (root_id, path, size, mtime_ms, quick_hash, asset_id, status, error, attempts, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'done', NULL, 0, ?)
         ON CONFLICT (root_id, path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, quick_hash = excluded.quick_hash,
           asset_id = excluded.asset_id, status = 'done', error = NULL, attempts = 0, updated_at = excluded.updated_at`,
      )
      .run(rootId, path, f.size, Math.floor(f.mtimeMs), f.quickHash, f.assetId, new Date().toISOString())
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

  forget(rootId: string, paths: string[]): void {
    const stmt = this.db.prepare('DELETE FROM files WHERE root_id = ? AND path = ?')
    for (const p of paths) stmt.run(rootId, p)
  }

  /** Roots no longer configured: forget their files (cf-dam already marked them missing). */
  keepRoots(rootIds: string[]): void {
    if (rootIds.length === 0) return
    this.db.prepare(`DELETE FROM files WHERE root_id NOT IN (${rootIds.map(() => '?').join(',')})`).run(...rootIds)
  }

  counts(): { done: number; error: number } {
    const row = this.db.prepare("SELECT SUM(status = 'done') AS done, SUM(status = 'error') AS error FROM files").get() as { done: number | null; error: number | null }
    return { done: row.done ?? 0, error: row.error ?? 0 }
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
    if (was !== c.sourceId) this.db.exec('DELETE FROM files')
    this.db.prepare("INSERT INTO meta (name, value) VALUES ('source_id', ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value").run(c.sourceId)
    writeFileSync(this.credentialsPath, JSON.stringify(c), { mode: 0o600 })
    chmodSync(this.credentialsPath, 0o600)
  }

  /** The key no longer works. The file list stays until a new pairing says whose it is. */
  clearCredentials(): void {
    writeFileSync(this.credentialsPath, '{}', { mode: 0o600 })
  }
}
