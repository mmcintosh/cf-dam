import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  backupDue,
  backupStep,
  backupPlan,
  chunkKey,
  CHUNK_ROWS,
  DEFAULT_BACKUP_CONFIG,
  getBackupState,
  importBackup,
  OMITTED_TABLES,
  readManifest,
  setBackupConfig,
  startBackup,
} from '../src/catalog/backups'
import { runSweep } from '../src/catalog/sweeper'
import { getConnection, providerFor } from '../src/storage/connections'
import { ADMIN, createHarness, createUser, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

async function upload(filename: string): Promise<string> {
  const res = await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength, allowDuplicate: true }), cookie: admin })
  const { uploadId } = (await res.json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

/** A catalog with people, photos, an album, keywords, a gallery and a code-protected account. */
async function fillCatalog(): Promise<void> {
  await createUser(h, admin, { name: 'Ed Editor', email: 'ed@example.com', password: 'editor password 1', roles: ['editor'] })
  const ids = [await upload('IMG_1.jpg'), await upload('IMG_2.jpg')]
  const album = (await (await h.fetch('/api/albums', { ...json({ name: 'Herons' }), cookie: admin })).json()) as { album: { id: string } }
  await h.fetch(`/api/albums/${album.album.id}/items`, { ...json({ assetIds: ids }), cookie: admin })
  await h.fetch('/api/assets/bulk', { ...json({ ids, action: 'tag-add', tags: ['heron', 'Birds|Waders'] }), cookie: admin })
  await h.fetch('/api/shares', { ...json({ albumId: album.album.id, name: 'Client', password: 'gallery pass 1' }), cookie: admin })
  await h.fetch('/api/auth/two-factor/enable', { ...json({ password: ADMIN.password }), cookie: admin })
}

const r2 = async () => providerFor(h.env, (await getConnection(h.env.DB, 'r2'))!)
/** Run backup steps until the backup finishes (a generous slice each). */
async function backUp(more: () => boolean = () => true): Promise<string> {
  const state = await startBackup(h.env, 'r2')
  for (let i = 0; i < 50; i++) {
    const step = await backupStep(h.env, more)
    if (step.finished) return step.finished
  }
  throw new Error(`backup ${state?.id} never finished`)
}

async function rowsOf(db: D1Database, table: string, omit: string[] = []) {
  const { results } = await db.prepare(`SELECT rowid AS _rowid_, * FROM "${table}" ORDER BY rowid`).all<Record<string, unknown>>()
  return results.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !omit.includes(k))))
}

describe('when a backup is due', () => {
  const config = { ...DEFAULT_BACKUP_CONFIG, hour: 3 }
  it('starts once a day, at the set hour (UTC)', () => {
    const at = (iso: string) => new Date(iso)
    expect(backupDue(config, null, at('2026-10-20T01:00:00Z'))).toBe(true)
    expect(backupDue(config, '2026-10-19T03:00:05Z', at('2026-10-20T02:59:00Z'))).toBe(false)
    expect(backupDue(config, '2026-10-19T03:00:05Z', at('2026-10-20T03:00:00Z'))).toBe(true)
    expect(backupDue(config, '2026-10-20T03:01:00Z', at('2026-10-20T23:00:00Z'))).toBe(false)
    expect(backupDue({ ...config, connectionId: null }, null)).toBe(false)
  })
})

describe('a catalog backup', () => {
  it('copies every table but the secret and rebuilt ones', async () => {
    const { tables, omit } = await backupPlan(h.env.DB)
    for (const name of Object.keys(OMITTED_TABLES)) expect(tables).not.toContain(name)
    expect(tables).toEqual(expect.arrayContaining(['users', 'assets', 'asset_locations', 'albums', 'album_items', 'tags', 'asset_tags', 'shares', 'settings', 'activity_log']))
    expect(tables.some((t) => t.includes('fts') || t.startsWith('search_index'))).toBe(false)
    // Each after the tables it points at: tags was rebuilt by a later migration, after asset_tags was made.
    expect(tables.indexOf('users')).toBeLessThan(tables.indexOf('assets'))
    expect(tables.indexOf('assets')).toBeLessThan(tables.indexOf('asset_tags'))
    expect(tables.indexOf('tags')).toBeLessThan(tables.indexOf('asset_tags'))
    // Secret columns, and a column pointing at an omitted table (agents' old API keys).
    expect(omit.sources).toEqual(expect.arrayContaining(['key_hash', 'api_key_id']))
    expect(omit.storage_connections).toEqual(['secret_sealed'])
  })

  it('comes back row for row in an empty database, without any sign-in secret', async () => {
    await fillCatalog()
    const id = await backUp()
    const provider = await r2()
    const manifest = (await readManifest(provider, id))!
    expect(manifest.tables.find((t) => t.name === 'assets')?.rows).toBe(2)
    expect(manifest.migrations).toContain('0028_backups')

    // Nothing secret in any chunk.
    const secrets = await h.env.DB.prepare(
      `SELECT (SELECT password FROM account LIMIT 1) AS password, (SELECT token FROM session LIMIT 1) AS token,
              (SELECT secret FROM two_factor LIMIT 1) AS totp`,
    ).first<Record<string, string>>()
    const { objects } = await provider.list(`cf-dam-backups/${id}/`)
    for (const object of objects.filter((o) => o.key.endsWith('.gz'))) {
      const text = await new Response((await provider.get(object.key))!.body.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).text()
      // Account passwords, sessions and code secrets. (A client gallery's password hash is kept, or a restored
      // gallery would open without its password.)
      for (const secret of Object.values(secrets!)) expect(text).not.toContain(secret)
    }

    // Into a fresh install: the same rows, table by table.
    const fresh = await createHarness()
    try {
      await importBackup(fresh.env.DB, provider, id)
      for (const table of manifest.tables) {
        const omit = [...table.omittedColumns]
        // A backup can't contain itself: its progress, or the log entry saying it finished.
        const original = (await rowsOf(h.env.DB, table.name, omit)).filter(
          (r) => !(table.name === 'settings' && r.key === 'backup.state') && !(table.name === 'activity_log' && r.action === 'backup.done'),
        )
        expect(await rowsOf(fresh.env.DB, table.name, omit), table.name).toEqual(original)
      }
      expect(await fresh.env.DB.prepare('SELECT COUNT(*) AS n FROM account').first('n')).toBe(0)
    } finally {
      await fresh.dispose()
    }
  })

  it('carries on across runs, and is unfinished until its manifest is written', async () => {
    await h.env.DB.prepare("INSERT INTO activity_log (id, action, created_at) SELECT 'a' || value, 'asset.uploaded', ? FROM json_each(?)")
      .bind(new Date().toISOString(), JSON.stringify(Array.from({ length: CHUNK_ROWS + 1200 }, (_, i) => i)))
      .run()
    const state = (await startBackup(h.env, 'r2'))!
    expect(await startBackup(h.env, 'r2')).toBeNull()
    // Two pages per run: the activity log takes several.
    let calls = 0
    const twoPages = () => {
      let n = 0
      return () => n++ < 2
    }
    let finished: string | null = null
    while (!finished && calls < 200) {
      calls++
      const step = await backupStep(h.env, twoPages())
      finished = step.finished
      if (!finished) expect(await readManifest(await r2(), state.id)).toBeNull()
    }
    expect(finished).toBe(state.id)
    expect(calls).toBeGreaterThan(3)
    expect(await getBackupState(h.env.DB)).toBeNull()
    const manifest = (await readManifest(await r2(), state.id))!
    const log = manifest.tables.find((t) => t.name === 'activity_log')!
    expect(log.rows).toBeGreaterThan(CHUNK_ROWS + 1200)
    expect(log.chunks).toBeGreaterThan(1)
    expect(await (await r2()).head(chunkKey(state.id, 'activity_log', 0))).not.toBeNull()
  }, 120_000)

  it('runs in the sweep once a day, and deletes old backups but never the newest', async () => {
    const first = (await runSweep(h.env)).backup
    expect(first.started).toBeTruthy()
    let finished = first.finished
    for (let i = 0; !finished && i < 20; i++) finished = (await runSweep(h.env)).backup.finished
    expect(finished).toBe(first.started)
    expect((await runSweep(h.env)).backup.started).toBeNull()

    // Two more today. With a one-day keep, the two aged past it go; today's newest stays.
    const old = await backUp()
    const newest = await backUp()
    await setBackupConfig(h.env.DB, { ...DEFAULT_BACKUP_CONFIG, keepDays: 1 })
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
    const age = (id: string, days: number) => h.env.DB.prepare('UPDATE backups SET started_at = ? WHERE id = ?').bind(daysAgo(days), id)
    await h.env.DB.batch([age(finished!, 3), age(old, 2)])
    const prune = async () => {
      for (let i = 0; i < 10; i++) expect((await backupStep(h.env, () => true)).started).toBeNull()
    }
    const left = async () => (await h.env.DB.prepare('SELECT id FROM backups ORDER BY started_at').all<{ id: string }>()).results.map((r) => r.id)
    await prune()
    expect(await left()).toEqual([newest])
    expect((await (await r2()).list(`cf-dam-backups/${finished}/`)).objects).toEqual([])
    expect((await (await r2()).list(`cf-dam-backups/${old}/`)).objects).toEqual([])

    // Even long past the keep period (backups off, so none is due), the newest finished one stays.
    await setBackupConfig(h.env.DB, { ...DEFAULT_BACKUP_CONFIG, connectionId: null, keepDays: 1 })
    await age(newest, 10).run()
    await prune()
    expect(await left()).toEqual([newest])
    expect(await readManifest(await r2(), newest)).not.toBeNull()
  })

  it('is set up and started from the Storage page', async () => {
    const page = (await (await h.fetch('/api/backups', { cookie: admin })).json()) as { config: { connectionId: string; hour: number; keepDays: number } }
    expect(page.config).toEqual(DEFAULT_BACKUP_CONFIG)
    const put = (body: unknown) => h.fetch('/api/backups/config', { method: 'PUT', body: JSON.stringify(body), cookie: admin })
    expect((await put({ connectionId: 'nope', hour: 3, keepDays: 30 })).status).toBe(400)
    expect((await put({ connectionId: 'r2', hour: 24, keepDays: 30 })).status).toBe(400)
    expect((await put({ connectionId: 'r2', hour: 22, keepDays: 14 })).status).toBe(200)

    const run = await h.fetch('/api/backups/run', { method: 'POST', cookie: admin })
    expect(run.status).toBe(202)
    expect((await h.fetch('/api/backups/run', { method: 'POST', cookie: admin })).status).toBe(409)
    const listed = (await (await h.fetch('/api/backups', { cookie: admin })).json()) as { running: { id: string } | null; backups: { status: string }[] }
    expect(listed.running?.id).toBe(((await run.json()) as { id: string }).id)
    expect(listed.backups[0]).toMatchObject({ status: 'running' })

    expect((await put({ connectionId: null, hour: 3, keepDays: 30 })).status).toBe(200)
    const editor = await createUser(h, admin, { name: 'Ed', email: 'ed@example.com', password: 'editor password 1', roles: ['editor'] })
    expect(editor).toBeTruthy()
  })
})
