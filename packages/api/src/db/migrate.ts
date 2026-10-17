/**
 * Runtime migrations.
 *
 * A Deploy-to-Cloudflare install never runs `wrangler d1 migrations apply`, so the Worker brings
 * its own schema up to date: the first request in each isolate applies whatever is pending. Each
 * migration runs as one D1 `batch`, which D1 executes as a transaction, and is then recorded in
 * `_migrations`. Statements are written idempotently (IF NOT EXISTS, INSERT OR IGNORE), so two
 * isolates racing on a fresh database converge instead of failing.
 */

export interface Migration {
  name: string
  sql: string
}

// Bundled at build time by Vite (Astro) and by Vitest alike; ordered by file name.
const files = import.meta.glob<string>('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export const MIGRATIONS: Migration[] = Object.entries(files)
  .map(([path, sql]) => ({ name: path.slice(path.lastIndexOf('/') + 1, -'.sql'.length), sql }))
  .sort((a, b) => a.name.localeCompare(b.name))

/**
 * Split a migration into statements. A statement ends at a `;` that ends a line, and `--`
 * comment lines are dropped. That rules out triggers with bodies, which cf-dam's schema does
 * not use; a migration that needs one must keep each inner statement off the line ending.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current: string[] = []
  for (const raw of sql.split('\n')) {
    const line = raw.trimEnd()
    if (line.trimStart().startsWith('--') || line.trim() === '') continue
    current.push(line)
    if (line.endsWith(';')) {
      statements.push(current.join('\n'))
      current = []
    }
  }
  if (current.length > 0) statements.push(current.join('\n'))
  return statements
}

/** Apply every pending migration in order. Returns the names applied by this call. */
export async function migrate(db: D1Database, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  await db
    .prepare('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
    .run()
  const done = await db.prepare('SELECT name FROM _migrations').all<{ name: string }>()
  const applied = new Set(done.results.map((r) => r.name))

  const ran: string[] = []
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue
    const statements = splitStatements(migration.sql).map((s) => db.prepare(s))
    statements.push(
      db
        .prepare('INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, ?)')
        .bind(migration.name, new Date().toISOString()),
    )
    await db.batch(statements)
    ran.push(migration.name)
  }
  return ran
}

// One attempt per isolate. A failure clears the memo so the next request retries rather than
// serving every later request from a half-migrated database.
let pending: Promise<unknown> | null = null

export function ensureMigrated(db: D1Database): Promise<unknown> {
  if (!pending) {
    pending = migrate(db).catch((error: unknown) => {
      pending = null
      throw error
    })
  }
  return pending
}
