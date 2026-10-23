import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { randomId } from '../lib/crypto'
import { BadRequest, optionalString, readJsonObject, requiredString, stringArray } from '../lib/http'
import { nowIso } from '../lib/time'
import { say } from '../lib/language'

export const albumRoutes = new Hono<DamEnv>()

interface AlbumRow {
  id: string
  name: string
  description: string
  cover_asset_id: string | null
  item_count: number
  created_at: string
  updated_at: string
}

const albumJson = (row: AlbumRow) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  coverAssetId: row.cover_asset_id,
  itemCount: row.item_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const ALBUM_SELECT = `SELECT al.*,
  COALESCE(al.cover_asset_id, (SELECT ai.asset_id FROM album_items ai WHERE ai.album_id = al.id ORDER BY ai.position, ai.added_at LIMIT 1)) AS cover_asset_id,
  (SELECT COUNT(*) FROM album_items ai JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL WHERE ai.album_id = al.id) AS item_count
  FROM albums al`

albumRoutes.get('/', requirePermission('assets:read'), async (c) => {
  const { results } = await c.env.DB.prepare(`${ALBUM_SELECT} ORDER BY al.updated_at DESC`).all<AlbumRow>()
  return c.json({ albums: results.map(albumJson) })
})

albumRoutes.get('/:id', requirePermission('assets:read'), async (c) => {
  const row = await c.env.DB.prepare(`${ALBUM_SELECT} WHERE al.id = ?`).bind(c.req.param('id')).first<AlbumRow>()
  return row ? c.json({ album: albumJson(row) }) : c.json({ error: 'not_found' }, 404)
})

albumRoutes.post('/', requirePermission('assets:edit'), async (c) => {
  try {
    const body = await readJsonObject(c)
    const id = randomId()
    const now = nowIso()
    await c.env.DB.prepare('INSERT INTO albums (id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, requiredString(body, 'name', 200), optionalString(body, 'description', 2000) ?? '', c.get('principal')!.userId, now, now)
      .run()
    const row = await c.env.DB.prepare(`${ALBUM_SELECT} WHERE al.id = ?`).bind(id).first<AlbumRow>()
    return c.json({ album: albumJson(row!) }, 201)
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

albumRoutes.patch('/:id', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    const name = optionalString(body, 'name', 200)
    if (name !== undefined && !name.trim()) throw new BadRequest(say('err.albumName'))
    const description = optionalString(body, 'description', 2000)
    const cover = body.coverAssetId
    if (cover !== undefined && cover !== null && typeof cover !== 'string') throw new BadRequest('coverAssetId must be an asset id.')
    const before = await c.env.DB.prepare('SELECT name FROM albums WHERE id = ?').bind(id).first<{ name: string }>()
    if (!before) return c.json({ error: 'not_found' }, 404)
    // The cover has to be one of the album's own photos.
    if (typeof cover === 'string' && !(await c.env.DB.prepare('SELECT 1 FROM album_items WHERE album_id = ? AND asset_id = ?').bind(id, cover).first())) {
      throw new BadRequest(say('err.coverInAlbum'))
    }
    await c.env.DB.prepare(
      `UPDATE albums SET name = COALESCE(?, name), description = COALESCE(?, description),
         cover_asset_id = CASE WHEN ? THEN ? ELSE cover_asset_id END, updated_at = ? WHERE id = ?`,
    )
      .bind(name?.trim() ?? null, description ?? null, cover !== undefined ? 1 : 0, cover ?? null, nowIso(), id)
      .run()
    if (name !== undefined && name.trim() !== before.name) {
      await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'album.renamed', targetType: 'album', targetId: id, details: { from: before.name, to: name.trim() }, ipAddress: c.req.header('cf-connecting-ip') })
    }
    return c.json({ ok: true })
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

/** The album only: its photos stay in the library. Its client gallery links go with it (ON DELETE CASCADE). */
albumRoutes.delete('/:id', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  const album = await c.env.DB.prepare(`SELECT name, (SELECT COUNT(*) FROM shares s WHERE s.album_id = albums.id) AS links FROM albums WHERE id = ?`)
    .bind(id)
    .first<{ name: string; links: number }>()
  if (!album) return c.json({ error: 'not_found' }, 404)
  await c.env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(id).run()
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'album.deleted', targetType: 'album', targetId: id, details: { name: album.name, links: album.links }, ipAddress: c.req.header('cf-connecting-ip') })
  return c.body(null, 204)
})

albumRoutes.post('/:id/items', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  try {
    const assetIds = stringArray(await readJsonObject(c), 'assetIds') ?? []
    if (assetIds.length === 0 || assetIds.length > 500) throw new BadRequest(say('err.addAssets', { max: 500 }))
    if (!(await c.env.DB.prepare('SELECT 1 FROM albums WHERE id = ?').bind(id).first())) return c.json({ error: 'not_found' }, 404)
    const now = nowIso()
    const start = (await c.env.DB.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM album_items WHERE album_id = ?').bind(id).first<{ next: number }>())?.next ?? 0
    await c.env.DB.batch([
      ...assetIds.map((assetId, i) =>
        c.env.DB.prepare('INSERT OR IGNORE INTO album_items (album_id, asset_id, position, added_at) SELECT ?, id, ?, ? FROM assets WHERE id = ? AND deleted_at IS NULL')
          .bind(id, start + i, now, assetId),
      ),
      c.env.DB.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').bind(now, id),
    ])
    return c.json({ ok: true })
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

albumRoutes.delete('/:id/items', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  try {
    const assetIds = stringArray(await readJsonObject(c), 'assetIds') ?? []
    if (assetIds.length === 0 || assetIds.length > 500) throw new BadRequest(say('err.removeAssets', { max: 500 }))
    if (!(await c.env.DB.prepare('SELECT 1 FROM albums WHERE id = ?').bind(id).first())) return c.json({ error: 'not_found' }, 404)
    await c.env.DB.batch([
      ...assetIds.map((assetId) => c.env.DB.prepare('DELETE FROM album_items WHERE album_id = ? AND asset_id = ?').bind(id, assetId)),
      // A cover that left the album falls back to the first photo.
      c.env.DB.prepare(`UPDATE albums SET updated_at = ?, cover_asset_id = CASE WHEN cover_asset_id IN (SELECT value FROM json_each(?)) THEN NULL ELSE cover_asset_id END WHERE id = ?`)
        .bind(nowIso(), JSON.stringify(assetIds), id),
    ])
    return c.body(null, 204)
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

