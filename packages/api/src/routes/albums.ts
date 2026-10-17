import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import type { DamEnv } from '../env'
import { randomId } from '../lib/crypto'
import { BadRequest, optionalString, readJsonObject, requiredString, stringArray } from '../lib/http'
import { nowIso } from '../lib/time'

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
    const description = optionalString(body, 'description', 2000)
    const cover = body.coverAssetId
    if (cover !== undefined && cover !== null && typeof cover !== 'string') throw new BadRequest('coverAssetId must be an asset id.')
    const result = await c.env.DB.prepare(
      `UPDATE albums SET name = COALESCE(?, name), description = COALESCE(?, description),
         cover_asset_id = CASE WHEN ? THEN ? ELSE cover_asset_id END, updated_at = ? WHERE id = ?`,
    )
      .bind(name ?? null, description ?? null, cover !== undefined ? 1 : 0, cover ?? null, nowIso(), id)
      .run()
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404)
    return c.json({ ok: true })
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

albumRoutes.delete('/:id', requirePermission('assets:edit'), async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(c.req.param('id')).run()
  return result.meta.changes === 0 ? c.json({ error: 'not_found' }, 404) : c.body(null, 204)
})

albumRoutes.post('/:id/items', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  try {
    const assetIds = stringArray(await readJsonObject(c), 'assetIds') ?? []
    if (assetIds.length === 0 || assetIds.length > 500) throw new BadRequest('Add between 1 and 500 assets at a time.')
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
    await c.env.DB.batch(assetIds.map((assetId) => c.env.DB.prepare('DELETE FROM album_items WHERE album_id = ? AND asset_id = ?').bind(id, assetId)))
    return c.body(null, 204)
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

export const tagRoutes = new Hono<DamEnv>()

tagRoutes.get('/', requirePermission('assets:read'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.name, COUNT(a.id) AS count FROM tags t
     JOIN asset_tags at ON at.tag_id = t.id JOIN assets a ON a.id = at.asset_id AND a.deleted_at IS NULL
     GROUP BY t.id ORDER BY count DESC, t.name LIMIT 500`,
  ).all<{ name: string; count: number }>()
  return c.json({ tags: results })
})
