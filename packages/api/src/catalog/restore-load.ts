/**
 * Putting a backup's rows back (plans/PLAN-BACKUP-RESTORE-v2.md in cf-dam-docs). Shared by the restore
 * (catalog/restore.ts) and the tests' one-go import (`importBackup`).
 *
 * A backup copies one table after another over hours, while people work, so it isn't one moment: a row can
 * be in it without the row it belongs to (a keyword AI review added after the keywords were copied, say).
 * Such a row is treated as the database treats a row whose parent is deleted: left out (CASCADE, RESTRICT,
 * NO ACTION), or put back with that link empty (SET NULL). Both are counted, so the restore can say so.
 *
 * Rows go in with ON CONFLICT DO NOTHING, never REPLACE: REPLACE settles a clash on any unique key by
 * deleting the row already there, and that delete cascades to what was loaded under it. So a row already
 * in stays (a duplicate of a unique key keeps the older row), and nothing loaded is ever taken away. Only
 * the tables a fresh install seeds take REPLACE, so the backup's values win over its defaults; nothing from
 * the backup points at them yet when they load.
 *
 * A table that points at itself (keywords under keywords) loads in passes: rows whose parent isn't in yet
 * wait for the next pass, until a pass adds nothing.
 */

/** Tables a fresh install already has rows in (its migrations seed them): the backup's rows replace those. */
export const SEED_TABLES = ['roles', 'permissions', 'role_permissions', 'storage_connections', 'settings'] as const

/** Columns given a value of their own rather than the backed-up one. */
export const OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // The search tables aren't backed up: every photo goes back in the sweep's queue to be indexed.
  assets: { indexed_at: 'NULL' },
  // Second-factor secrets aren't backed up, so nobody comes back with codes turned on.
  users: { two_factor_enabled: '0' },
}

/** Rows per statement at most: through json_each, because D1 binds at most 100 values per statement. */
export const GROUP_ROWS = 200
/** And bytes of JSON per statement at most: D1 takes a bound string of up to 2 MB, and a photo's row is wide. */
export const GROUP_BYTES = 1_000_000

export interface ForeignKey {
  column: string
  parent: string
  /** The parent's column it matches. */
  to: string
  /** ON DELETE SET NULL: a missing parent empties the link rather than leaving the row out. */
  setNull: boolean
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`
const field = (column: string) => `json_extract(j.value, '$."${column.replace(/"/g, '\\"')}"')`
const parentThere = (key: ForeignKey) => `EXISTS (SELECT 1 FROM ${quote(key.parent)} WHERE ${quote(key.to)} = ${field(key.column)})`
const linkOk = (key: ForeignKey) => `(${field(key.column)} IS NULL OR ${parentThere(key)})`

/** Each table's foreign keys, from this install's schema (keys into tables it doesn't have are left out). */
export async function readKeys(db: D1Database, tables: readonly string[]): Promise<Map<string, ForeignKey[]>> {
  const [existing, ...lists] = await db.batch([
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'"),
    ...tables.map((name) => db.prepare('SELECT "table" AS parent, "from" AS col, "to" AS target, on_delete FROM pragma_foreign_key_list(?)').bind(name)),
  ])
  const have = new Set((existing!.results as { name: string }[]).map((r) => r.name))
  const keys = new Map<string, ForeignKey[]>()
  tables.forEach((name, i) => {
    const rows = lists[i]!.results as { parent: string; col: string; target: string | null; on_delete: string }[]
    keys.set(
      name,
      rows
        // Every key in cf-dam's schema names its column (`to`); one that doesn't would point at a primary key.
        .filter((r) => have.has(r.parent) && r.target)
        .map((r) => ({ column: r.col, parent: r.parent, to: r.target!, setNull: r.on_delete.toUpperCase() === 'SET NULL' })),
    )
  })
  return keys
}

/** Tables in the order given, except that each waits for the ones it points at (among `names`). */
export function orderTables(names: readonly string[], pointsAt: (name: string) => Iterable<string>): string[] {
  const inSet = new Set(names)
  const needs = new Map(names.map((n) => [n, [...pointsAt(n)].filter((t) => t !== n && inSet.has(t))]))
  const tables: string[] = []
  const placed = new Set<string>()
  while (tables.length < names.length) {
    const next = names.find((n) => !placed.has(n) && needs.get(n)!.every((t) => placed.has(t)))
    if (!next) throw new Error(`Tables point at each other in a circle: ${names.filter((n) => !placed.has(n)).join(', ')}`)
    tables.push(next)
    placed.add(next)
  }
  return tables
}

/** The key a table has to itself, if any (only CASCADE and the like: a SET NULL one would need a pass that fills it in). */
export function selfKey(table: string, keys: readonly ForeignKey[]): ForeignKey | null {
  const own = keys.filter((k) => k.parent === table)
  if (own.some((k) => k.setNull)) throw new Error(`${table} points at itself with ON DELETE SET NULL, which a restore can't load in passes yet.`)
  return own[0] ?? null
}

/** How deep each row sits under its own table's rows in this chunk (0: its parent isn't in the chunk). */
function depths(rows: readonly Record<string, unknown>[], key: ForeignKey): number[] {
  const byId = new Map(rows.map((r, i) => [r[key.to], i]))
  const memo = new Array<number>(rows.length).fill(-1)
  const depth = (i: number, seen = 0): number => {
    if (memo[i]! >= 0) return memo[i]!
    const parent = rows[i]![key.column]
    const at = parent === null || parent === undefined ? undefined : byId.get(parent)
    // A loop (it can't be, but a backup is outside data) stops at its length.
    memo[i] = at === undefined || at === i || seen > rows.length ? 0 : depth(at, seen + 1) + 1
    return memo[i]!
  }
  return rows.map((_, i) => depth(i))
}

/** A chunk of a table that points at itself, parents first, each row with its depth. */
export function parentsFirst(rows: Record<string, unknown>[], key: ForeignKey): Record<string, unknown>[] {
  const d = depths(rows, key)
  return rows
    .map((row, i) => ({ row, depth: d[i]!, i }))
    .sort((a, b) => a.depth - b.depth || a.i - b.i)
    .map(({ row, depth }) => Object.assign(row, { _depth_: depth }))
}

const encoder = new TextEncoder()

/** The next rows to put in from `offset`: at most GROUP_ROWS and GROUP_BYTES, and (in passes) one depth at a time. */
export function nextGroup(rows: readonly Record<string, unknown>[], offset: number): Record<string, unknown>[] {
  const group: Record<string, unknown>[] = []
  let bytes = 0
  for (let i = offset; i < rows.length && group.length < GROUP_ROWS; i++) {
    const row = rows[i]!
    // A child in the same statement as its parent can't see it: rows of the next depth wait for the next statement.
    if (group.length > 0 && row._depth_ !== group[0]!._depth_) break
    const size = encoder.encode(JSON.stringify(row)).length
    if (group.length > 0 && bytes + size > GROUP_BYTES) break
    group.push(row)
    bytes += size
  }
  return group
}

export interface LoadTable {
  name: string
  /** The columns this install's table has: a column the backup has and this schema doesn't is left out. */
  columns: readonly string[]
}

function columnsOf(table: LoadTable, rows: readonly Record<string, unknown>[]): string[] {
  const columns = Object.keys(rows[0]!).filter((c) => c !== '_rowid_' && c !== '_depth_' && table.columns.includes(c))
  for (const c of Object.keys(OVERRIDES[table.name] ?? {})) if (!columns.includes(c) && table.columns.includes(c)) columns.push(c)
  return columns
}

/**
 * Put rows back: those whose parents are in (a missing SET NULL parent empties the link). `guard`, when
 * given, is one more condition every row must meet (the restore's "this run still holds the job").
 */
export function loadStatement(
  db: D1Database,
  table: LoadTable,
  keys: readonly ForeignKey[],
  rows: readonly Record<string, unknown>[],
  guard?: { sql: string; binds: unknown[] },
  options: { overrides?: boolean } = {},
): D1PreparedStatement {
  const columns = columnsOf(table, rows)
  // `overrides: false` loads rows exactly as backed up (the tests' check that a backup is whole).
  const overrides = options.overrides === false ? {} : (OVERRIDES[table.name] ?? {})
  const emptied = new Map(keys.filter((k) => k.setNull && columns.includes(k.column)).map((k) => [k.column, k]))
  const values = [
    field('_rowid_'),
    ...columns.map((c) => {
      if (overrides[c]) return overrides[c]
      const key = emptied.get(c)
      return key ? `CASE WHEN ${linkOk(key)} THEN ${field(c)} END` : field(c)
    }),
  ]
  const where = keys.filter((k) => !k.setNull && columns.includes(k.column)).map(linkOk)
  if (guard) where.push(guard.sql)
  const seed = (SEED_TABLES as readonly string[]).includes(table.name)
  const sql =
    `${seed ? 'INSERT OR REPLACE' : 'INSERT'} INTO ${quote(table.name)} (rowid, ${columns.map(quote).join(', ')}) ` +
    `SELECT ${values.join(', ')} FROM json_each(?) AS j WHERE ${where.length ? where.join(' AND ') : '1'}` +
    // The WHERE is always there: without it SQLite would read ON CONFLICT as part of the SELECT.
    (seed ? '' : ' ON CONFLICT DO NOTHING')
  return db.prepare(sql).bind(JSON.stringify(rows), ...(guard?.binds ?? []))
}

/** Links a group's rows would lose (SET NULL keys whose parent isn't in), by column; null if the table has none. */
export function emptiedStatement(db: D1Database, table: LoadTable, keys: readonly ForeignKey[], rows: readonly Record<string, unknown>[]): D1PreparedStatement | null {
  const columns = columnsOf(table, rows)
  const setNull = keys.filter((k) => k.setNull && columns.includes(k.column))
  if (setNull.length === 0) return null
  const where = keys.filter((k) => !k.setNull && columns.includes(k.column)).map(linkOk)
  const sums = setNull.map((k, i) => `COALESCE(SUM(${field(k.column)} IS NOT NULL AND NOT ${parentThere(k)}), 0) AS e${i}`)
  return db.prepare(`SELECT ${sums.join(', ')} FROM json_each(?) AS j WHERE ${where.length ? where.join(' AND ') : '1'}`).bind(JSON.stringify(rows))
}

/** What `emptiedStatement` found, as "table.column" → count (zeros left out). */
export function emptiedCounts(table: string, keys: readonly ForeignKey[], columns: readonly string[], row: Record<string, number> | null): Record<string, number> {
  const setNull = keys.filter((k) => k.setNull && columns.includes(k.column))
  const out: Record<string, number> = {}
  setNull.forEach((k, i) => {
    const n = Number(row?.[`e${i}`] ?? 0)
    if (n > 0) out[`${table}.${k.column}`] = n
  })
  return out
}

/** The columns a group would load (for `emptiedCounts`). */
export const groupColumns = columnsOf

/** A promise that gives up after `ms` (an S3 read with no timeout of its own could outlive the run's lease). */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} s.`)), ms)
    }),
  ])
}
