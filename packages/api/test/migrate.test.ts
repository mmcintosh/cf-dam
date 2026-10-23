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
    expect(roles.results.map((r) => r.name)).toEqual(['admin', 'client', 'editor', 'viewer'])
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

  it('upgrades tags that land on one keyword, and folds case beyond A–Z (0008, 0018)', async () => {
    h = await createHarness({}, { migrations: MIGRATIONS.filter((m) => m.name < '0008') })
    const db = h.env.DB
    const now = new Date().toISOString()
    await db.batch([
      db.prepare("INSERT INTO assets (id, filename, mime_type, status, created_at, updated_at) VALUES ('a1', 'x.jpg', 'image/jpeg', 'ready', ?, ?), ('a2', 'y.jpg', 'image/jpeg', 'ready', ?, ?)").bind(now, now, now, now),
      // 'a|b' and 'a/b' are one keyword now; SQLite's NOCASE let 'Österreich' and 'österreich' both exist.
      db.prepare("INSERT INTO tags (id, name, created_at) VALUES ('t1', 'a/b', '2020-01-01'), ('t2', 'a|b', '2021-01-01'), ('t3', 'Österreich', '2020-01-01'), ('t4', 'österreich', '2021-01-01'), ('t5', 'Trips > 2019', '2020-01-01')"),
      db.prepare("INSERT INTO asset_tags (asset_id, tag_id, source, created_at) VALUES ('a1', 't1', 'user', ?), ('a2', 't2', 'user', ?), ('a2', 't4', 'import', ?), ('a1', 't5', 'user', ?)").bind(now, now, now, now),
    ])
    expect(await migrate(db)).toEqual(expect.arrayContaining(['0008_keywords_labels', '0017_keyword_name_key', '0018_keyword_keys']))
    const tags = await db.prepare('SELECT id, name, name_key, path, full_path FROM tags ORDER BY id').all()
    expect(tags.results).toEqual([
      { id: 't1', name: 'a/b', name_key: 'a/b', path: 'a/b', full_path: 'a/b' },
      // The one whose key was already right is kept.
      { id: 't4', name: 'österreich', name_key: 'österreich', path: 'österreich', full_path: 'österreich' },
      { id: 't5', name: 'Trips / 2019', name_key: 'trips / 2019', path: 'trips / 2019', full_path: 'Trips / 2019' },
    ])
    const kept = await db.prepare('SELECT asset_id, tag_id FROM asset_tags ORDER BY asset_id, tag_id').all()
    expect(kept.results).toEqual([
      { asset_id: 'a1', tag_id: 't1' },
      { asset_id: 'a1', tag_id: 't5' },
      { asset_id: 'a2', tag_id: 't1' },
      { asset_id: 'a2', tag_id: 't4' },
    ])
  })

  it('merges keywords whose branches turn out to be one, children and all (0018)', async () => {
    h = await createHarness({}, { migrations: MIGRATIONS.filter((m) => m.name < '0018') })
    const db = h.env.DB
    const now = new Date().toISOString()
    // As SQLite lower-cased them: two Österreich branches, each with a Wien.
    await db.batch([
      db.prepare("INSERT INTO assets (id, filename, mime_type, status, created_at, updated_at) VALUES ('a1', 'x.jpg', 'image/jpeg', 'ready', ?, ?), ('a2', 'y.jpg', 'image/jpeg', 'ready', ?, ?)").bind(now, now, now, now),
      db.prepare(
        `INSERT INTO tags (id, name, name_key, parent_id, path, full_path, created_at) VALUES
           ('o1', 'Österreich', 'Österreich', NULL, 'Österreich', 'Österreich', '2020-01-01'),
           ('w1', 'Wien', 'wien', 'o1', 'Österreich|wien', 'Österreich|Wien', '2020-01-01'),
           ('o2', 'österreich', 'österreich', NULL, 'österreich', 'österreich', '2021-01-01'),
           ('w2', 'WIEN', 'wien', 'o2', 'österreich|wien', 'österreich|WIEN', '2021-01-01'),
           ('g2', 'Graz', 'graz', 'o2', 'österreich|graz', 'österreich|Graz', '2021-01-01')`,
      ),
      db.prepare("INSERT INTO asset_tags (asset_id, tag_id, source, created_at) VALUES ('a1', 'w1', 'user', ?), ('a2', 'w2', 'user', ?), ('a2', 'g2', 'user', ?)").bind(now, now, now),
    ])
    expect(await migrate(db, MIGRATIONS.filter((m) => m.name < '0019'))).toEqual(['0018_keyword_keys'])
    const tags = await db.prepare('SELECT id, parent_id, path, full_path FROM tags ORDER BY path').all()
    // The one already right (o2's path) is kept; the rest join it.
    expect(tags.results).toEqual([
      { id: 'o2', parent_id: null, path: 'österreich', full_path: 'österreich' },
      { id: 'g2', parent_id: 'o2', path: 'österreich|graz', full_path: 'österreich|Graz' },
      { id: 'w2', parent_id: 'o2', path: 'österreich|wien', full_path: 'österreich|WIEN' },
    ])
    const kept = await db.prepare('SELECT asset_id, tag_id FROM asset_tags ORDER BY asset_id, tag_id').all()
    expect(kept.results).toEqual([
      { asset_id: 'a1', tag_id: 'w2' },
      { asset_id: 'a2', tag_id: 'g2' },
      { asset_id: 'a2', tag_id: 'w2' },
    ])
    // Run again: nothing left to do.
    await (await import('../src/db/repairs')).repairKeywordKeys(db)
    expect((await db.prepare('SELECT COUNT(*) AS n FROM tags').first<{ n: number }>())?.n).toBe(3)
  })

  it('moves search to the numbered index without losing what is indexed (0019)', async () => {
    h = await createHarness({}, { migrations: MIGRATIONS.filter((m) => m.name < '0019') })
    const db = h.env.DB
    const now = new Date().toISOString()
    await db.batch([
      db.prepare(
        `INSERT INTO assets (id, filename, mime_type, status, created_at, updated_at, deleted_at) VALUES
           ('a1', 'fjord.jpg', 'image/jpeg', 'ready', ?, ?, NULL), ('a2', 'harbour.jpg', 'image/jpeg', 'ready', ?, ?, NULL),
           ('a3', 'gone.jpg', 'image/jpeg', 'ready', ?, ?, ?), ('a4', 'never.jpg', 'image/jpeg', 'ready', ?, ?, NULL)`,
      ).bind(now, now, now, now, now, now, now, now, now),
      // a1 twice (a delete that failed once), a3 deleted since, a4 never indexed.
      db.prepare(
        `INSERT INTO assets_fts (asset_id, filename, title, caption, tags, camera, place, ai) VALUES
           ('a1', 'old fjord', '', '', '', '', '', ''), ('a1', 'fjord', '', '', 'Bergen', '', '', ''),
           ('a2', 'harbour', '', '', '', '', '', ''), ('a3', 'gone', '', '', '', '', '', '')`,
      ),
    ])
    expect(await migrate(db, MIGRATIONS.filter((m) => m.name < '0020'))).toEqual(['0019_search_keys'])
    const found = async (q: string) =>
      (await db.prepare('SELECT a.id FROM assets a WHERE a.search_id IN (SELECT rowid FROM search_index WHERE search_index MATCH ?) ORDER BY a.id').bind(q).all<{ id: string }>()).results.map((r) => r.id)
    expect(await found('bergen')).toEqual(['a1'])
    expect(await found('old')).toEqual([])
    expect(await found('gone')).toEqual([])
    expect(await found('harbour')).toEqual(['a2'])
    // What wasn't indexed is left for the sweep.
    const { results } = await db.prepare('SELECT id FROM assets WHERE indexed_at IS NULL AND deleted_at IS NULL').all<{ id: string }>()
    expect(results.map((r) => r.id)).toEqual(['a4'])
  })
})
