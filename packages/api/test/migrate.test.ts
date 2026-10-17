import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate, splitStatements } from '../src/db/migrate'
import { createHarness, type Harness } from './harness'

describe('splitStatements', () => {
  it('splits on line-ending semicolons and drops comments and blank lines', () => {
    const sql = `-- header\nCREATE TABLE a (\n  x TEXT -- trailing; not a split\n);\n\nINSERT INTO a VALUES ('x;y');\n`
    expect(splitStatements(sql)).toEqual([
      'CREATE TABLE a (\n  x TEXT -- trailing; not a split\n);',
      "INSERT INTO a VALUES ('x;y');",
    ])
  })
})

describe('migrate', () => {
  let h: Harness | undefined
  afterEach(async () => h?.dispose())

  it('bundles the migrations in name order', () => {
    expect(MIGRATIONS.map((m) => m.name)).toContain('0001_auth')
    expect(MIGRATIONS.map((m) => m.name)).toEqual([...MIGRATIONS.map((m) => m.name)].sort())
  })

  it('applies once and is a no-op the second time', async () => {
    h = await createHarness() // the harness has already migrated
    expect(await migrate(h.env.DB)).toEqual([])
    const roles = await h.env.DB.prepare('SELECT name FROM roles ORDER BY name').all<{ name: string }>()
    expect(roles.results.map((r) => r.name)).toEqual(['admin', 'editor', 'viewer'])
  })

  it('seeds the admin role with every permission', async () => {
    h = await createHarness()
    const row = await h.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM permissions) AS total,
              (SELECT COUNT(*) FROM role_permissions WHERE role_id = 'role-admin') AS admin`,
    ).first<{ total: number; admin: number }>()
    expect(row?.admin).toBe(row?.total)
  })
})
