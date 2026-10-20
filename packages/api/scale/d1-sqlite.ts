/**
 * A D1-shaped database over Node's built-in SQLite, for the scale test: the app's own query code
 * runs unchanged against a catalog of a million-plus rows on local disk, at no cost.
 *
 * Only what cf-dam uses: prepare/bind/first/all/run/raw, batch (one transaction) and exec. Timings
 * are local CPU, without D1's network hop; what carries over to D1 is the query plans (a full scan
 * here is a full scan there, billed per row read) and the database's size.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

type Value = SQLInputValue
const toValue = (v: unknown): Value => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : (v as Value))
const RETURNS_ROWS = /^\s*(SELECT|WITH|PRAGMA|VALUES|EXPLAIN)\b|\bRETURNING\b/i

export interface Recorded {
  sql: string
  params: Value[]
  ms: number
}

class Statement {
  constructor(
    private readonly owner: D1Sqlite,
    readonly sql: string,
    readonly params: Value[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    // D1's own limits, which Node's SQLite doesn't have: found the hard way.
    if (values.length > 100) throw new Error(`D1 binds at most 100 values per statement; this has ${values.length}.`)
    return new Statement(this.owner, this.sql, values.map(toValue))
  }

  private exec(): { rows: Record<string, unknown>[]; changes: number; lastRowId: number } {
    const started = performance.now()
    const statement = this.owner.sqlite.prepare(this.sql)
    try {
      if (RETURNS_ROWS.test(this.sql)) {
        const rows = statement.all(...this.params) as Record<string, unknown>[]
        return { rows: rows.map((r) => ({ ...r })), changes: 0, lastRowId: 0 }
      }
      const result = statement.run(...this.params)
      return { rows: [], changes: Number(result.changes), lastRowId: Number(result.lastInsertRowid) }
    } finally {
      this.owner.record(this.sql, this.params, performance.now() - started)
    }
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.exec().rows[0]
    if (!row) return null
    return (column ? row[column] : row) as T
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const { rows, changes, lastRowId } = this.exec()
    return { results: rows as T[], success: true, meta: { changes, last_row_id: lastRowId } } as unknown as D1Result<T>
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.all<T>()
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return this.exec().rows.map((r) => Object.values(r)) as T[]
  }

  /** For batch: the same result, run inside the batch's transaction. */
  runNow(): D1Result {
    const { rows, changes, lastRowId } = this.exec()
    return { results: rows, success: true, meta: { changes, last_row_id: lastRowId } } as unknown as D1Result
  }
}

export class D1Sqlite {
  readonly sqlite: DatabaseSync
  /** Every statement run since the last `take()`, with how long it took. */
  private log: Recorded[] = []

  constructor(path: string) {
    this.sqlite = new DatabaseSync(path)
    this.sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF; PRAGMA foreign_keys = ON;')
  }

  record(sql: string, params: Value[], ms: number) {
    this.log.push({ sql, params, ms })
  }

  take(): Recorded[] {
    const log = this.log
    this.log = []
    return log
  }

  prepare(sql: string): Statement {
    // D1 refused a compound SELECT of 12 terms (its limit isn't documented; SQLite's default is 500).
    const terms = (sql.match(/\bUNION\b/gi) ?? []).length + 1
    if (terms > 5) throw new Error(`D1 refuses compound SELECTs this long (${terms} terms).`)
    return new Statement(this, sql)
  }

  async batch(statements: Statement[]): Promise<D1Result[]> {
    this.sqlite.exec('BEGIN')
    try {
      const results = statements.map((s) => s.runNow())
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const started = performance.now()
    this.sqlite.exec(sql)
    return { count: 1, duration: performance.now() - started }
  }

  /** The query plan's lines, e.g. "SCAN assets" or "SEARCH assets USING INDEX …". */
  plan(sql: string, params: unknown[] = []): string[] {
    return (this.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params.map(toValue)) as { detail: string }[]).map((r) => r.detail)
  }

  close() {
    this.sqlite.close()
  }
}

/** Typed as D1 for the app's functions. */
export const asD1 = (db: D1Sqlite) => db as unknown as D1Database
