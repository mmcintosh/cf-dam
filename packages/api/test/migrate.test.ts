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

  it('seeds the admin role with every permission except agent:sync, which no role holds', async () => {
    h = await createHarness()
    const row = await h.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM permissions WHERE id != 'agent:sync') AS total,
              (SELECT COUNT(*) FROM role_permissions WHERE role_id = 'role-admin') AS admin,
              (SELECT COUNT(*) FROM role_permissions WHERE permission_id = 'agent:sync') AS agent`,
    ).first<{ total: number; admin: number; agent: number }>()
    expect(row?.admin).toBe(row?.total)
    expect(row?.agent).toBe(0)
  })

  it('rebuilds tags as a tree without losing anyone\'s tags (0008)', async () => {
    h = await createHarness({}, { migrations: MIGRATIONS.filter((m) => m.name < '0008') })
    const db = h.env.DB
    const now = new Date().toISOString()
    await db.batch([
      db.prepare("INSERT INTO assets (id, filename, mime_type, status, created_at, updated_at) VALUES ('a1', 'x.jpg', 'image/jpeg', 'ready', ?, ?)").bind(now, now),
      db.prepare("INSERT INTO tags (id, name, created_at) VALUES ('t1', 'Norway', ?), ('t2', 'odd|name', ?)").bind(now, now),
      db.prepare("INSERT INTO asset_tags (asset_id, tag_id, source, created_at) VALUES ('a1', 't1', 'user', ?), ('a1', 't2', 'ai', ?)").bind(now, now),
    ])
    expect(await migrate(db)).toContain('0008_keywords_labels')
    const tags = await db.prepare('SELECT id, name, parent_id, path, full_path FROM tags ORDER BY id').all()
    expect(tags.results).toEqual([
      { id: 't1', name: 'Norway', parent_id: null, path: 'norway', full_path: 'Norway' },
      { id: 't2', name: 'odd/name', parent_id: null, path: 'odd/name', full_path: 'odd/name' },
    ])
    const kept = await db.prepare('SELECT tag_id, source FROM asset_tags ORDER BY tag_id').all()
    expect(kept.results).toEqual([
      { tag_id: 't1', source: 'user' },
      { tag_id: 't2', source: 'ai' },
    ])
    // The foreign keys still hold: deleting the asset still clears its tags.
    await db.prepare("DELETE FROM assets WHERE id = 'a1'").run()
    expect((await db.prepare('SELECT COUNT(*) AS n FROM asset_tags').first<{ n: number }>())?.n).toBe(0)
  })
})
