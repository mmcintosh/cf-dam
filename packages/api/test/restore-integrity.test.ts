/**
 * Backups that restore (plans/PLAN-BACKUP-RESTORE-v2.md in cf-dam-docs): rows written while a backup ran, keywords
 * moved under newer ones, a progress write lost after its rows went in, duplicates of a unique key, old backups and
 * old restores, and what the restore says didn't come back.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupStep, getBackupState, startBackup, type BackupManifest } from '../src/catalog/backups'
import { GROUP_BYTES, GROUP_ROWS, nextGroup, orderTables, parentsFirst, selfKey } from '../src/catalog/restore-load'
import { currentRestore, ONE_OFF_SETTINGS, restoreStep, type RestoreReport } from '../src/catalog/restore'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))
const R2 = { kind: 'r2' }

let old: Harness
let fresh: Harness | null = null
let admin: string

beforeEach(async () => {
  old = await createHarness()
  admin = await setUpAdmin(old)
})
afterEach(async () => {
  await fresh?.dispose()
  fresh = null
  await old.dispose()
})

const at = () => new Date().toISOString()
const all = async (h: Harness, sql: string) => (await h.env.DB.prepare(sql).all<Record<string, unknown>>()).results
const one = async (h: Harness, sql: string) => (await h.env.DB.prepare(sql).first<{ n: number }>())!.n

async function upload(filename: string): Promise<string> {
  const res = await old.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength, allowDuplicate: true }), cookie: admin })
  const { uploadId } = (await res.json()) as { uploadId: string }
  const put = await old.fetch(`/api/uploads/${uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await old.fetch(`/api/uploads/${uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

/** A backup taken a table per step; `between` runs after each step, told which tables are copied. */
async function backUp(between: (copied: Set<string>) => Promise<void> = async () => {}): Promise<string> {
  await startBackup(old.env, 'r2')
  for (let i = 0; i < 300; i++) {
    let n = 0
    // Two calls of `more`: one to start a table, one for its (single) page.
    const step = await backupStep(old.env, () => n++ < 2)
    if (step.finished) return step.finished
    const state = (await getBackupState(old.env.DB))!
    await between(new Set(state.tables.slice(0, state.table)))
  }
  throw new Error('the backup never finished')
}

async function restore(id: string, env?: Harness['env']): Promise<RestoreReport> {
  fresh ??= await createHarness({ MEDIA_BUCKET: old.env.MEDIA_BUCKET })
  expect((await fresh.fetch('/api/setup/restore', json({ source: R2, backupId: id }))).status).toBe(202)
  for (let steps = 0; steps < 2000; steps++) {
    let n = 0
    const step = await restoreStep(env ?? fresh.env, () => n++ < 3)
    if (step?.status === 'restored') return (await currentRestore(fresh.env.DB))!.report!
    if (step?.status === 'failed') throw new Error(`the restore failed: ${(await currentRestore(fresh.env.DB))?.error}`)
  }
  throw new Error('the restore never finished')
}

/** 300 keywords; the first 40 moved under keywords made 250 later (in a later group of rows), those under the last. */
async function movedKeywords(photo: string): Promise<void> {
  const db = old.env.DB
  const ids = Array.from({ length: 300 }, (_, i) => `kw${String(i).padStart(3, '0')}`)
  await db
    .prepare("INSERT INTO tags (id, name, parent_id, path, full_path, created_at) SELECT value, value, NULL, value, value, ? FROM json_each(?)")
    .bind(at(), JSON.stringify(ids))
    .run()
  const top = ids[299]!
  const statements = []
  for (let i = 250; i < 290; i++) {
    statements.push(db.prepare('UPDATE tags SET parent_id = ?, path = ?, full_path = ? WHERE id = ?').bind(top, `${top}|${ids[i]}`, `${top}|${ids[i]}`, ids[i]))
  }
  for (let i = 0; i < 40; i++) {
    const parent = ids[i + 250]!
    statements.push(db.prepare('UPDATE tags SET parent_id = ?, path = ?, full_path = ? WHERE id = ?').bind(parent, `${top}|${parent}|${ids[i]}`, `${top}|${parent}|${ids[i]}`, ids[i]))
  }
  statements.push(db.prepare("INSERT INTO asset_tags (asset_id, tag_id, source, created_at) SELECT ?, value, 'user', ? FROM json_each(?)").bind(photo, at(), JSON.stringify(ids)))
  await db.batch(statements)
}

const keywordRows = (h: Harness) => all(h, 'SELECT id, parent_id, path FROM tags ORDER BY id')
const taggedRows = (h: Harness) => all(h, 'SELECT asset_id, tag_id FROM asset_tags ORDER BY asset_id, tag_id')

describe('the database the tests run on', () => {
  it('enforces foreign keys, or nothing below proves anything', async () => {
    expect(await old.env.DB.prepare('PRAGMA foreign_keys').first('foreign_keys')).toBe(1)
    await expect(old.env.DB.prepare("INSERT INTO asset_tags (asset_id, tag_id, created_at) VALUES ('nope', 'nope', 'x')").run()).rejects.toThrow(/FOREIGN KEY/)
  })
})

describe('putting rows back', () => {
  it('orders tables by their keys, and puts a chunk of keywords parents first', () => {
    expect(orderTables(['b', 'a', 'c'], (n) => (n === 'b' ? ['a'] : n === 'a' ? ['c'] : []))).toEqual(['c', 'a', 'b'])
    expect(() => orderTables(['a', 'b'], (n) => (n === 'a' ? ['b'] : ['a']))).toThrow(/circle/)
    const key = { column: 'parent_id', parent: 'tags', to: 'id', setNull: false }
    expect(selfKey('tags', [key])).toEqual(key)
    expect(() => selfKey('t', [{ column: 'p', parent: 't', to: 'id', setNull: true }])).toThrow(/SET NULL/)
    const rows = parentsFirst([{ id: 'c', parent_id: 'b' }, { id: 'b', parent_id: 'a' }, { id: 'a', parent_id: null }, { id: 'x', parent_id: 'elsewhere' }], key)
    expect(rows.map((r) => r.id)).toEqual(['a', 'x', 'b', 'c'])
    // One depth per statement: a child can't see a parent inserted by the same statement.
    expect(nextGroup(rows, 0).map((r) => r.id)).toEqual(['a', 'x'])
  })

  it('cuts groups at 200 rows and at about a megabyte', () => {
    const small = Array.from({ length: 450 }, (_, i) => ({ _rowid_: i, v: 'x' }))
    expect(nextGroup(small, 0)).toHaveLength(GROUP_ROWS)
    const wide = Array.from({ length: 10 }, (_, i) => ({ _rowid_: i, metadata: 'é'.repeat(200_000) }))
    const group = nextGroup(wide, 0)
    expect(group.length).toBeGreaterThan(0)
    expect(new TextEncoder().encode(JSON.stringify(group)).length).toBeLessThanOrEqual(GROUP_BYTES + 1000)
    // A single row bigger than that still goes, on its own.
    expect(nextGroup([{ _rowid_: 1, big: 'x'.repeat(GROUP_BYTES + 5) }], 0)).toHaveLength(1)
  })

  it('reseeds settings defaults but never one-off work a restored catalog had finished', () => {
    const seeded = new Set<string>()
    const dir = new URL('../src/db/migrations/', import.meta.url)
    for (const file of readdirSync(dir)) {
      const sql = new TextDecoder().decode(readFileSync(new URL(file, dir)))
      for (const statement of sql.split(/;\s*\n/)) {
        if (!/INSERT OR IGNORE INTO settings/i.test(statement)) continue
        // Each row's first value is its key ('%Y-…' is a strftime pattern, not a key).
        for (const [, key] of statement.matchAll(/\(\s*'([^'%]+)'\s*,/g)) seeded.add(key!)
      }
    }
    // Each is either a default the restored catalog may lack (it comes back) or one-off work (it never does).
    const defaults = ['auth.registration_open', 'labels.names', 'ai.enabled', 'ai.auto', 'ai.model', 'ai.context', 'faces.on', 'faces.epoch']
    expect([...seeded].sort()).toEqual([...defaults, ...ONE_OFF_SETTINGS].sort())
  })
})

describe('restoring a backup', () => {
  it('brings back keywords moved under newer ones, across groups of rows', async () => {
    const photo = await upload('IMG_1.jpg')
    await movedKeywords(photo)
    const report = await restore(await backUp())
    expect(await keywordRows(fresh!)).toEqual(await keywordRows(old))
    expect(await taggedRows(fresh!)).toEqual(await taggedRows(old))
    expect(report.left).toEqual({})
    expect(report.short).toEqual({})
    expect(await all(fresh!, 'PRAGMA foreign_key_check')).toEqual([])
  }, 180_000)

  it('leaves out rows written during the backup under something newer, empties SET NULL links, and says so', async () => {
    const photos = [await upload('IMG_1.jpg'), await upload('IMG_2.jpg')]
    const album = (await (await old.fetch('/api/albums', { ...json({ name: 'Herons' }), cookie: admin })).json()) as { album: { id: string } }
    await old.fetch(`/api/albums/${album.album.id}/items`, { ...json({ assetIds: photos }), cookie: admin })
    await old.env.DB.prepare("INSERT INTO clients (id, name, created_at, updated_at) VALUES ('client-1', 'Smith', ?, ?)").bind(at(), at()).run()
    const done = new Set<string>()
    const once = async (name: string, copied: Set<string>, before: string, after: string, write: () => Promise<unknown>) => {
      if (done.has(name) || !copied.has(before) || copied.has(after)) return
      done.add(name)
      await write()
    }
    const id = await backUp(async (copied) => {
      const db = old.env.DB
      // A keyword AI review adds after the keywords were copied, on a photo.
      await once('tag', copied, 'tags', 'asset_tags', () =>
        db.batch([
          db.prepare("INSERT INTO tags (id, name, path, full_path, created_at) VALUES ('late-tag', 'Late', 'late', 'Late', ?)").bind(at()),
          db.prepare("INSERT INTO asset_tags (asset_id, tag_id, source, created_at) VALUES (?, 'late-tag', 'ai', ?)").bind(photos[0], at()),
        ]),
      )
      // A helper's photo found after the photos were copied, with its location; and a photo deleted.
      await once('photo', copied, 'assets', 'asset_locations', () =>
        db.batch([
          db.prepare("INSERT INTO assets (id, filename, mime_type, status, created_at, updated_at) VALUES ('late-photo', 'late.jpg', 'image/jpeg', 'ready', ?, ?)").bind(at(), at()),
          db.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, state, updated_at) VALUES ('late-photo', 'r2', 'originals/late.jpg', 'present', ?)").bind(at()),
          db.prepare('DELETE FROM assets WHERE id = ?').bind(photos[1]),
        ]),
      )
      // A job made after the jobs were copied, given to the album before the albums are.
      await once('job', copied, 'jobs', 'albums', () =>
        db.batch([
          db.prepare("INSERT INTO jobs (id, client_id, title, stage_at, created_at, updated_at) VALUES ('late-job', 'client-1', 'Wedding', ?, ?, ?)").bind(at(), at(), at()),
          db.prepare("UPDATE albums SET job_id = 'late-job' WHERE id = ?").bind(album.album.id),
        ]),
      )
    })
    expect([...done].sort()).toEqual(['job', 'photo', 'tag'])
    const report = await restore(id)
    expect(report.left).toEqual({ asset_tags: 1, asset_locations: 1 })
    expect(report.emptied).toEqual({ 'albums.job_id': 1 })
    expect(report.short).toEqual({})
    expect(await all(fresh!, 'PRAGMA foreign_key_check')).toEqual([])
    expect(await all(fresh!, 'SELECT job_id FROM albums')).toEqual([{ job_id: null }])
    // The deleted photo is back as the backup had it (copied before it went), its children gone with it.
    expect(await one(fresh!, 'SELECT COUNT(*) AS n FROM assets')).toBe(2)
    // The setup page shows it.
    const setup = (await (await fresh!.fetch('/api/setup')).json()) as { restore: { report: RestoreReport } }
    expect(setup.restore.report.left).toEqual({ asset_tags: 1, asset_locations: 1 })
  }, 180_000)

  it('never loads a group twice when the progress write is lost after its rows went in', async () => {
    const photo = await upload('IMG_1.jpg')
    await movedKeywords(photo)
    const id = await backUp()
    fresh = await createHarness({ MEDIA_BUCKET: old.env.MEDIA_BUCKET })
    // D1 commits the batch, then the answer is lost: twice, a few groups apart.
    const real = fresh.env.DB
    let batches = 0
    const losing = new Proxy(real, {
      get(target, prop) {
        if (prop === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            const results = await target.batch(statements)
            batches++
            if (statements.length === 2 && (batches === 6 || batches === 14)) throw new Error('the connection dropped after the commit')
            return results
          }
        }
        const value = Reflect.get(target, prop)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const report = await restore(id, { ...fresh.env, DB: losing })
    expect(batches).toBeGreaterThan(14)
    expect(await keywordRows(fresh)).toEqual(await keywordRows(old))
    expect(await taggedRows(fresh)).toEqual(await taggedRows(old))
    expect(report.left).toEqual({})
    // Rows read once each, and the failures counted only while in a row.
    const job = await fresh.env.DB.prepare('SELECT rows, total_rows, failures FROM restore_jobs').first<{ rows: number; total_rows: number; failures: number }>()
    expect(job).toMatchObject({ failures: 0 })
    expect(job!.rows).toBe(job!.total_rows)
  }, 180_000)

  it('keeps the older of two rows with one unique key, and its keywords under it', async () => {
    const photo = await upload('IMG_1.jpg')
    const db = old.env.DB
    await db.batch([
      db.prepare("INSERT INTO tags (id, name, path, full_path, created_at) VALUES ('birds', 'Birds', 'birds', 'Birds', ?)").bind(at()),
      db.prepare("INSERT INTO tags (id, name, parent_id, path, full_path, created_at) VALUES ('heron', 'Heron', 'birds', 'birds|heron', 'Birds|Heron', ?)").bind(at()),
      db.prepare("INSERT INTO asset_tags (asset_id, tag_id, created_at) VALUES (?, 'heron', ?)").bind(photo, at()),
    ])
    const id = await backUp()
    // A newer "birds" (made after the old one was renamed away and back, while the backup ran), with a child of its own.
    const r2 = old.env.MEDIA_BUCKET!
    const manifest = JSON.parse(await (await r2.get(`cf-dam-backups/${id}/manifest.json`))!.text()) as BackupManifest
    const tags = manifest.tables.find((t) => t.name === 'tags')!
    const key = `cf-dam-backups/${id}/tags/${tags.files?.[0] ?? '00000.ndjson.gz'}`
    const text = await new Response((await r2.get(key))!.body.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).text()
    // Shaped like the backup's own rows (every column, as a backup writes them).
    const like = JSON.parse(text.split('\n')[0]!) as Record<string, unknown>
    const extra = [
      { ...like, _rowid_: 9000, id: 'birds-2', name: 'Birds', parent_id: null, path: 'birds', full_path: 'Birds' },
      { ...like, _rowid_: 9001, id: 'egret', name: 'Egret', parent_id: 'birds-2', path: 'birds|egret', full_path: 'Birds|Egret' },
    ]
    const body = text + extra.map((r) => JSON.stringify(r)).join('\n') + '\n'
    await r2.put(key, await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
    tags.rows += 2
    if (tags.chunkRows) tags.chunkRows[0]! += 2
    await r2.put(`cf-dam-backups/${id}/manifest.json`, JSON.stringify(manifest))

    const report = await restore(id)
    expect(await all(fresh!, "SELECT id, parent_id FROM tags WHERE path LIKE 'birds%' ORDER BY path")).toEqual([
      { id: 'birds', parent_id: null },
      { id: 'heron', parent_id: 'birds' },
    ])
    expect(await taggedRows(fresh!)).toEqual(await taggedRows(old))
    // The newer one, and the keyword under it, are counted.
    expect(report.left).toEqual({ tags: 2 })
  }, 180_000)

  it('restores a backup made before chunks had their own names, and says when a backup is short', async () => {
    await upload('IMG_1.jpg')
    const id = await backUp()
    // As backups made before 2026-11-04 are: plain chunk names, no per-chunk counts.
    const r2 = old.env.MEDIA_BUCKET!
    const manifest = JSON.parse(await (await r2.get(`cf-dam-backups/${id}/manifest.json`))!.text()) as BackupManifest
    for (const table of manifest.tables) {
      for (let seq = 0; seq < table.chunks; seq++) {
        const from = `cf-dam-backups/${id}/${table.name}/${table.files![seq]}`
        await r2.put(`cf-dam-backups/${id}/${table.name}/${String(seq).padStart(5, '0')}.ndjson.gz`, await (await r2.get(from))!.arrayBuffer())
        await r2.delete(from)
      }
      delete table.files
      delete table.chunkRows
    }
    // And one that lists more photos than it holds.
    manifest.tables.find((t) => t.name === 'assets')!.rows += 3
    await r2.put(`cf-dam-backups/${id}/manifest.json`, JSON.stringify(manifest))

    const report = await restore(id)
    expect(report.short).toEqual({ assets: { expected: 4, read: 1 } })
    expect(await one(fresh!, 'SELECT COUNT(*) AS n FROM assets')).toBe(1)
    const page = (await (await fresh!.fetch('/api/setup')).json()) as { restore: { status: string } }
    expect(page.restore.status).toBe('restored')
  }, 180_000)

  it('carries on a restore started by the version before, and keeps one-off work finished', async () => {
    await upload('IMG_1.jpg')
    const photo = (await all(old, 'SELECT id FROM assets'))[0]!.id as string
    await movedKeywords(photo)
    // Finished in the old install: the key is gone, so it mustn't come back.
    await old.env.DB.prepare("DELETE FROM settings WHERE key = 'quick_hash.fill'").run()
    await old.env.DB.prepare("UPDATE roles SET label = 'Photo editors' WHERE id = 'role-editor'").run()
    const id = await backUp()
    fresh = await createHarness({ MEDIA_BUCKET: old.env.MEDIA_BUCKET })
    expect((await fresh.fetch('/api/setup/restore', json({ source: R2, backupId: id }))).status).toBe(202)
    // A few steps in, the progress is put back as the version before saved it (no step, no passes, no report).
    for (let i = 0; i < 4; i++) {
      let n = 0
      await restoreStep(fresh.env, () => n++ < 3)
    }
    const row = await fresh.env.DB.prepare('SELECT progress FROM restore_jobs').first<{ progress: string }>()
    const progress = JSON.parse(row!.progress) as Record<string, unknown>
    for (const field of ['step', 'pass', 'passFrom', 'report']) delete progress[field]
    progress.offset = 0
    await fresh.env.DB.prepare('UPDATE restore_jobs SET progress = ?, lease_until = NULL').bind(JSON.stringify(progress)).run()
    for (let steps = 0; steps < 2000; steps++) {
      let n = 0
      if ((await restoreStep(fresh.env, () => n++ < 3))?.status === 'restored') break
    }
    expect((await currentRestore(fresh.env.DB))?.status).toBe('restored')
    expect(await keywordRows(fresh)).toEqual(await keywordRows(old))
    expect(await taggedRows(fresh)).toEqual(await taggedRows(old))
    expect(await one(fresh, "SELECT COUNT(*) AS n FROM settings WHERE key = 'quick_hash.fill'")).toBe(0)
    expect(await all(fresh, "SELECT label FROM roles WHERE id = 'role-editor'")).toEqual([{ label: 'Photo editors' }])
    // The newer version's own seeds still come back.
    expect(await one(fresh, "SELECT COUNT(*) AS n FROM settings WHERE key = 'faces.epoch'")).toBe(1)
  }, 180_000)
})
