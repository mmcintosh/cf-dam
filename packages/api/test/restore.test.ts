import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupStep, readManifest, startBackup } from '../src/catalog/backups'
import { recordHashes } from '../src/catalog/phash'
import { restoreStep } from '../src/catalog/restore'
import { runSweep } from '../src/catalog/sweeper'
import { getConnection, providerFor } from '../src/storage/connections'
import { ADMIN, cookiesFrom, createHarness, createUser, json, setUpAdmin, signIn, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

/** The install that made the backup, and the fresh one it comes back into (sharing its R2 bucket). */
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

async function upload(filename: string): Promise<string> {
  const res = await old.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength, allowDuplicate: true }), cookie: admin })
  const { uploadId } = (await res.json()) as { uploadId: string }
  const put = await old.fetch(`/api/uploads/${uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await old.fetch(`/api/uploads/${uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

/** People, photos with hashes, an album and keywords; then a finished backup of it all. */
async function backedUpCatalog(): Promise<{ id: string; photos: string[]; editor: string }> {
  const editor = await createUser(old, admin, { name: 'Ed Editor', email: 'ed@example.com', password: 'editor password 1', roles: ['editor'] })
  const photos = [await upload('IMG_1.jpg'), await upload('IMG_2.jpg')]
  const album = (await (await old.fetch('/api/albums', { ...json({ name: 'Herons' }), cookie: admin })).json()) as { album: { id: string } }
  await old.fetch(`/api/albums/${album.album.id}/items`, { ...json({ assetIds: photos }), cookie: admin })
  await old.fetch('/api/assets/bulk', { ...json({ ids: photos, action: 'tag-add', tags: ['heron'] }), cookie: admin })
  await recordHashes(old.env.DB, [
    { id: photos[0]!, hash: 'f0e1d2c3b4a59687' },
    { id: photos[1]!, hash: 'f0e1d2c3b4a59686' },
  ])
  await old.fetch('/api/auth/two-factor/enable', { ...json({ password: ADMIN.password }), cookie: admin })
  await startBackup(old.env, 'r2')
  for (let i = 0; i < 50; i++) {
    const step = await backupStep(old.env, () => true)
    if (step.finished) return { id: step.finished, photos, editor }
  }
  throw new Error('the backup never finished')
}

/** A fresh install, nobody set up, with the old one's R2 bucket. */
async function freshInstall(): Promise<Harness> {
  fresh = await createHarness({ MEDIA_BUCKET: old.env.MEDIA_BUCKET })
  return fresh
}

const R2 = { kind: 'r2' }
const setupState = async (h: Harness) => (await (await h.fetch('/api/setup')).json()) as { needed: boolean; restore: { status: string; rows: number; totalRows: number; phase: string; error: string | null } | null }
const count = async (h: Harness, sql: string) => (await h.env.DB.prepare(sql).first<{ n: number }>())!.n

/** Restore steps, a few inserts at a time, until it's loaded. Returns how many steps it took. */
async function loadAll(h: Harness): Promise<number> {
  for (let steps = 1; steps < 500; steps++) {
    let n = 0
    const step = await restoreStep(h.env, () => n++ < 3)
    if (step?.status === 'restored') return steps
    if (step?.status === 'failed') throw new Error('the restore failed')
  }
  throw new Error('the restore never finished')
}

describe('restoring a backup into a fresh install', () => {
  it('brings the catalog back, rebuilds what backups leave out, and signs the person restoring in', async () => {
    const { id, photos, editor } = await backedUpCatalog()
    const h = await freshInstall()
    expect(await setupState(h)).toMatchObject({ needed: true, restore: null })

    const listed = await h.fetch('/api/setup/restore/backups', json({ source: R2 }))
    expect(listed.status).toBe(200)
    const { backups } = (await listed.json()) as { backups: { id: string; photos: number; problem: string | null }[] }
    expect(backups).toEqual([expect.objectContaining({ id, photos: 2, problem: null })])

    expect((await h.fetch('/api/setup/restore', json({ source: R2, backupId: id }))).status).toBe(202)
    // Mid-restore: nobody signs in, no other administrator can be made, and the sweep does only this.
    expect((await h.fetch('/api/setup', json({ name: 'X', email: 'x@example.com', password: 'another long password' }))).status).toBe(409)
    expect((await h.fetch('/api/setup/restore', json({ source: R2, backupId: id }))).status).toBe(400)
    let n = 0
    await restoreStep(h.env, () => n++ < 2)
    expect((await signIn(h, ADMIN.email, ADMIN.password)).status).toBe(403)
    // The sweep gives a restore the whole run (here, enough to finish it), and does nothing else.
    const swept = await runSweep(h.env)
    expect(swept.restore?.status).toBe('restored')
    expect(swept.processed + swept.indexed + swept.checked).toBe(0)
    expect((await setupState(h)).restore).toMatchObject({ status: 'restored', rows: expect.any(Number) })

    // The photos, album and keywords are back; the look-alike bands are rebuilt; nobody has a password or codes.
    for (const table of ['assets', 'albums', 'album_items', 'tags', 'asset_tags', 'users', 'user_roles', 'similar_pairs']) {
      expect(await count(h, `SELECT COUNT(*) AS n FROM ${table}`), table).toBe(await count(old, `SELECT COUNT(*) AS n FROM ${table}`))
    }
    expect(await count(h, 'SELECT COUNT(*) AS n FROM asset_hash_bands')).toBe(await count(old, 'SELECT COUNT(*) AS n FROM asset_hash_bands'))
    expect(await count(h, 'SELECT COUNT(*) AS n FROM asset_hash_bands')).toBeGreaterThan(0)
    expect(await count(h, 'SELECT COUNT(*) AS n FROM account')).toBe(0)
    expect(await count(h, 'SELECT COUNT(*) AS n FROM users WHERE two_factor_enabled = 1')).toBe(0)
    expect(await count(h, 'SELECT COUNT(*) AS n FROM assets WHERE indexed_at IS NOT NULL')).toBe(0)
    // What this version adds to an older backup comes back too.
    expect(await count(h, "SELECT COUNT(*) AS n FROM role_permissions WHERE permission_id = 'alerts:read'")).toBe(1)

    // The administrator's own email: their account again, with the password they choose now.
    const finished = await h.fetch('/api/setup/restore/finish', json({ name: 'Ada', email: ADMIN.email, password: 'a brand new password' }))
    expect(finished.status).toBe(200)
    const cookie = cookiesFrom(finished)
    const me = (await (await h.fetch('/api/me', { cookie })).json()) as { email: string; roles: string[] }
    expect(me).toMatchObject({ email: ADMIN.email, roles: expect.arrayContaining(['admin']) })
    expect(await setupState(h)).toMatchObject({ needed: false, restore: null })
    expect((await h.fetch('/api/setup/restore/finish', json({ name: 'Ada', email: ADMIN.email, password: 'a brand new password' }))).status).toBe(409)
    expect(await count(h, "SELECT COUNT(*) AS n FROM activity_log WHERE action = 'setup.restored'")).toBe(1)

    // The sweep rebuilds the search index.
    await runSweep(h.env)
    const found = (await (await h.fetch('/api/assets?q=heron', { cookie })).json()) as { assets: { id: string }[] }
    expect(found.assets.map((a) => a.id).sort()).toEqual([...photos].sort())

    // Everyone else gets a temporary password from the People page, and can then sign in.
    expect((await signIn(h, 'ed@example.com', 'editor password 1')).status).toBe(401)
    expect((await h.fetch(`/api/users/${editor}/password`, { ...json({ password: 'temporary password 9' }), cookie })).status).toBe(200)
    expect((await signIn(h, 'ed@example.com', 'temporary password 9')).status).toBe(200)
  }, 180_000)

  it('makes a new administrator when the email is not in the backup', async () => {
    const { id } = await backedUpCatalog()
    const h = await freshInstall()
    await h.fetch('/api/setup/restore', json({ source: R2, backupId: id }))
    // A part at a time, over many runs.
    expect(await loadAll(h)).toBeGreaterThan(5)
    const finished = await h.fetch('/api/setup/restore/finish', json({ name: 'New Admin', email: 'new@example.com', password: 'a brand new password' }))
    expect(finished.status).toBe(200)
    const me = (await (await h.fetch('/api/me', { cookie: cookiesFrom(finished) })).json()) as { email: string; roles: string[] }
    expect(me).toMatchObject({ email: 'new@example.com', roles: ['admin'] })
    expect(await count(h, 'SELECT COUNT(*) AS n FROM users')).toBe(3)
  }, 180_000)

  it('carries on where it stopped after failing, and only with the same backup', async () => {
    const { id } = await backedUpCatalog()
    const h = await freshInstall()
    const r2 = providerFor(h.env, (await getConnection(h.env.DB, 'r2'))!)
    // A chunk goes missing part-way.
    const manifest = (await readManifest(r2, id))!
    const assets = `cf-dam-backups/${id}/assets/00000.ndjson.gz`
    const saved = await (await h.env.MEDIA_BUCKET!.get(assets))!.arrayBuffer()
    await h.env.MEDIA_BUCKET!.delete(assets)
    await h.fetch('/api/setup/restore', json({ source: R2, backupId: id }))
    let status = 'running'
    for (let i = 0; i < 20 && status === 'running'; i++) status = (await restoreStep(h.env, () => true))?.status ?? status
    expect(status).toBe('failed')
    const failed = (await setupState(h)).restore!
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringContaining('missing assets chunk 0') })
    expect(failed.rows).toBeGreaterThan(0)
    expect(failed.rows).toBeLessThan(manifest.tables.reduce((n, t) => n + t.rows, 0))

    // Another backup can't be mixed in; the same one carries on.
    expect((await h.fetch('/api/setup/restore', json({ source: R2, backupId: 'another' }))).status).toBe(400)
    await h.env.MEDIA_BUCKET!.put(assets, saved)
    expect((await h.fetch('/api/setup/restore', json({ source: R2, backupId: id }))).status).toBe(202)
    await loadAll(h)
    expect(await count(h, 'SELECT COUNT(*) AS n FROM assets')).toBe(2)
  }, 180_000)

  it('gives agents their own entries back when they pair again', async () => {
    // An agent on the old install, with a folder.
    const start = (await (await old.fetch('/api/agent/pair/start', json({ name: 'Studio NAS', platform: 'linux/x64', version: '1.0.0' }))).json()) as { deviceCode: string; userCode: string }
    await old.fetch('/api/sources/pair', { ...json({ code: start.userCode }), cookie: admin })
    const { sourceId } = (await (await old.fetch('/api/agent/pair/poll', json({ deviceCode: start.deviceCode }))).json()) as { sourceId: string }
    const { id } = await backedUpCatalog()
    const h = await freshInstall()
    await h.fetch('/api/setup/restore', json({ source: R2, backupId: id }))
    await loadAll(h)
    const cookie = cookiesFrom(await h.fetch('/api/setup/restore/finish', json({ name: 'Ada', email: ADMIN.email, password: 'a brand new password' })))
    const before = (await (await h.fetch('/api/sources', { cookie })).json()) as { sources: { id: string; waiting: boolean }[] }
    expect(before.sources).toEqual([expect.objectContaining({ id: sourceId, waiting: true })])

    // The agent, refused, pairs again saying which entry it had.
    const again = (await (await h.fetch('/api/agent/pair/start', json({ name: 'Studio NAS', platform: 'linux/x64', version: '1.1.0', previousSourceId: sourceId }))).json()) as { deviceCode: string; userCode: string }
    const preview = (await (await h.fetch(`/api/sources/pair/${again.userCode}`, { cookie })).json()) as { previous: { id: string } | null; reconnectable: { id: string }[] }
    expect(preview.previous?.id).toBe(sourceId)
    expect(preview.reconnectable.map((s) => s.id)).toEqual([sourceId])
    expect((await h.fetch('/api/sources/pair', { ...json({ code: again.userCode, sourceId }), cookie })).status).toBe(201)
    const polled = (await (await h.fetch('/api/agent/pair/poll', json({ deviceCode: again.deviceCode }))).json()) as { status: string; apiKey: string; sourceId: string }
    expect(polled).toMatchObject({ status: 'approved', sourceId })
    const beat = await h.fetch('/api/agent/heartbeat', { ...json({ version: '1.1.0', status: {} }), headers: { Authorization: `Bearer ${polled.apiKey}` } })
    expect(beat.status).toBe(200)
    const after = (await (await h.fetch('/api/sources', { cookie })).json()) as { sources: { id: string; waiting: boolean; version: string }[] }
    expect(after.sources).toEqual([expect.objectContaining({ id: sourceId, waiting: false, version: '1.1.0' })])
    expect(await count(h, "SELECT COUNT(*) AS n FROM activity_log WHERE action = 'source.reconnected'")).toBe(1)

    // Taken: a second agent can't claim it.
    const third = (await (await h.fetch('/api/agent/pair/start', json({ name: 'Imposter', previousSourceId: sourceId }))).json()) as { userCode: string }
    expect(((await (await h.fetch(`/api/sources/pair/${third.userCode}`, { cookie })).json()) as { previous: unknown }).previous).toBeNull()
    expect((await h.fetch('/api/sources/pair', { ...json({ code: third.userCode, sourceId }), cookie })).status).toBe(409)
  }, 180_000)

  it('refuses a backup from a newer version, and an install that already has accounts', async () => {
    const { id } = await backedUpCatalog()
    const manifest = JSON.parse(await (await old.env.MEDIA_BUCKET!.get(`cf-dam-backups/${id}/manifest.json`))!.text()) as { migrations: string[] }
    manifest.migrations.push('9999_from_the_future')
    await old.env.MEDIA_BUCKET!.put(`cf-dam-backups/${id}/manifest.json`, JSON.stringify(manifest))
    const h = await freshInstall()
    const { backups } = (await (await h.fetch('/api/setup/restore/backups', json({ source: R2 }))).json()) as { backups: { problem: string | null }[] }
    expect(backups[0]!.problem).toContain('newer version of cf-dam')
    const refused = await h.fetch('/api/setup/restore', json({ source: R2, backupId: id }))
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { message: string }).message).toContain('9999_from_the_future')

    // An S3 address that isn't https (outside localhost) is refused before anything is asked of it.
    const plain = await h.fetch('/api/setup/restore/backups', json({ source: { kind: 's3', endpoint: 'http://example.com', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' } }))
    expect(plain.status).toBe(400)

    await setUpAdmin(h)
    expect((await h.fetch('/api/setup/restore/backups', json({ source: R2 }))).status).toBe(409)
  }, 180_000)
})
