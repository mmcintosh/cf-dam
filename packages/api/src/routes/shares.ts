/**
 * Client gallery links, the photographer's side: make, edit and revoke links to albums, see who
 * opened them and what they picked, and set the watermark.
 */
import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import {
  createShare,
  getShare,
  listShares,
  parseShareInput,
  pickedAssets,
  revokeShare,
  shareDownloads,
  sharePicks,
  shareVisitors,
  updateShare,
  type ShareRow,
} from '../catalog/shares'
import { getWatermark, MAX_WATERMARK_BYTES, removeWatermarkImage, setWatermarkImage, updateWatermark, watermarkKey, WatermarkRejected, type WatermarkPosition } from '../catalog/watermark'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { randomId } from '../lib/crypto'
import { BadRequest, readJsonObject, requiredString, stringArray } from '../lib/http'
import { nowIso } from '../lib/time'
import { renditionStore } from '../storage/connections'

export const shareRoutes = new Hono<DamEnv>()

shareRoutes.use('*', requirePermission('shares:manage'))

const invalid = (error: unknown) => {
  if (error instanceof BadRequest || error instanceof WatermarkRejected) return { error: 'invalid_request', message: error.message }
  throw error
}

shareRoutes.get('/', async (c) => c.json({ shares: await listShares(c.env.DB, c.req.query('albumId') || undefined) }))

shareRoutes.post('/', async (c) => {
  try {
    const body = await readJsonObject(c)
    const albumId = requiredString(body, 'albumId', 64)
    const principal = c.get('principal')!
    const share = await createShare(c.env.DB, albumId, parseShareInput(body, true), principal.userId)
    if (!share) return c.json({ error: 'not_found', message: 'No such album.' }, 404)
    await logActivity(c.env.DB, { userId: principal.userId, action: 'share.create', targetType: 'share', targetId: share.id, details: { albumId }, ipAddress: c.req.header('cf-connecting-ip') })
    return c.json({ share }, 201)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

// The watermark routes come before /:id so "watermark" isn't taken for a link id.
shareRoutes.get('/watermark', async (c) => c.json({ watermark: await getWatermark(c.env.DB) }))

shareRoutes.patch('/watermark', async (c) => {
  try {
    const body = await readJsonObject(c)
    const watermark = await updateWatermark(c.env, {
      position: typeof body.position === 'string' ? (body.position as WatermarkPosition) : undefined,
      scale: typeof body.scale === 'number' ? body.scale : undefined,
      opacity: typeof body.opacity === 'number' ? body.opacity : undefined,
    })
    return c.json({ watermark })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

shareRoutes.get('/watermark/image', async (c) => {
  const { version } = await getWatermark(c.env.DB)
  const object = version ? await renditionStore(c.env).get(watermarkKey(version)) : null
  if (!object) return c.json({ error: 'not_found' }, 404)
  return new Response(object.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' } })
})

shareRoutes.put('/watermark/image', async (c) => {
  const length = Number(c.req.header('Content-Length') ?? NaN)
  if (!Number.isFinite(length) || length > MAX_WATERMARK_BYTES) return c.json({ error: 'invalid_request', message: 'A watermark must be an image of at most 2 MB.' }, 400)
  try {
    const watermark = await setWatermarkImage(c.env, await c.req.arrayBuffer())
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'watermark.set', ipAddress: c.req.header('cf-connecting-ip') })
    return c.json({ watermark })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

shareRoutes.delete('/watermark/image', async (c) => c.json({ watermark: await removeWatermarkImage(c.env.DB) }))

shareRoutes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const share = await getShare(c.env.DB, id)
  if (!share) return c.json({ error: 'not_found' }, 404)
  const [visitors, picks, downloads] = await Promise.all([shareVisitors(c.env.DB, id), sharePicks(c.env.DB, id), shareDownloads(c.env.DB, id)])
  return c.json({ share, visitors, picks, downloads })
})

shareRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const changed = await updateShare(c.env.DB, id, parseShareInput(await readJsonObject(c), false))
    if (!changed) return c.json({ error: 'not_found', message: 'No such link, or it was revoked.' }, 404)
    return c.json({ share: await getShare(c.env.DB, id) })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

shareRoutes.post('/:id/revoke', async (c) => {
  const id = c.req.param('id')
  if (!(await revokeShare(c.env.DB, id))) return c.json({ error: 'not_found', message: 'No such link, or it was already revoked.' }, 404)
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'share.revoke', targetType: 'share', targetId: id, ipAddress: c.req.header('cf-connecting-ip') })
  return c.json({ share: await getShare(c.env.DB, id) })
})

/** A new album holding the photos picked on this link: by any of the chosen people, or by all of them. */
shareRoutes.post('/:id/picks/album', async (c) => {
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    const share = await c.env.DB.prepare('SELECT id, album_id FROM shares WHERE id = ?').bind(id).first<Pick<ShareRow, 'id' | 'album_id'>>()
    if (!share) return c.json({ error: 'not_found' }, 404)
    const name = requiredString(body, 'name', 200)
    const visitorIds = stringArray(body, 'visitorIds') ?? null
    const mode = body.mode === 'all' ? 'all' : 'any'
    const assetIds = await pickedAssets(c.env.DB, share, visitorIds && visitorIds.length > 0 ? visitorIds : null, mode)
    if (assetIds.length === 0) throw new BadRequest('Nothing has been picked by those people.')
    const albumId = randomId()
    const now = nowIso()
    const principal = c.get('principal')!
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO albums (id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(albumId, name, '', principal.userId, now, now),
      c.env.DB.prepare(
        `INSERT INTO album_items (album_id, asset_id, position, added_at)
         SELECT ?, value, key, ? FROM json_each(?)`,
      ).bind(albumId, now, JSON.stringify(assetIds)),
    ])
    return c.json({ albumId, count: assetIds.length }, 201)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})
