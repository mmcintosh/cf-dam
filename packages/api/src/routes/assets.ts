import { Hono, type Context } from 'hono'
import { requirePermission } from '../auth/principal'
import { assetJson, getAsset, getLocations, getTags, listAssets, primaryLocation, softDeleteAsset, updateAsset } from '../catalog/assets'
import { SAFE_INLINE_TYPES } from '../catalog/metadata'
import { processAsset } from '../catalog/process'
import { isRenditionName, renditionKey } from '../catalog/renditions'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject, stringArray } from '../lib/http'
import { nowIso } from '../lib/time'
import { getConnection, providerFor, renditionStore } from '../storage/connections'
import { ARCHIVE_CLASSES, attachmentDisposition, isStorageClass, RESTORE_TIERS, StorageError, type RestoreTier } from '../storage/types'

export const assetRoutes = new Hono<DamEnv>()

function storageFailure(c: Context<DamEnv>, error: unknown) {
  if (error instanceof StorageError) return c.json({ error: 'storage_error', code: error.code, message: error.message }, error.status === 404 ? 404 : 502)
  if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
  throw error
}

const int = (value: string | undefined) => (value && /^\d+$/.test(value) ? Number(value) : undefined)

assetRoutes.get('/', requirePermission('assets:read'), async (c) => {
  const q = c.req.query()
  const sort = q.sort === 'added' ? 'added' : 'captured'
  return c.json(
    await listAssets(c.env.DB, {
      q: q.q, tag: q.tag, camera: q.camera, albumId: q.album, from: q.from, to: q.to, sort,
      limit: int(q.limit), offset: int(q.offset),
    }),
  )
})

assetRoutes.get('/:id', requirePermission('assets:read'), async (c) => {
  const id = c.req.param('id')
  const row = await getAsset(c.env.DB, id)
  if (!row) return c.json({ error: 'not_found' }, 404)
  const [locations, tags, renditions] = await Promise.all([
    getLocations(c.env.DB, id),
    getTags(c.env.DB, id),
    c.env.DB.prepare('SELECT name, width, height, size, source FROM renditions WHERE asset_id = ?').bind(id).all(),
  ])
  let metadata: unknown = null
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : null
  } catch {
    metadata = null
  }
  return c.json({
    ...assetJson(row, renditions.results.map((r) => r.name as string)),
    tags,
    metadata,
    locations: locations.map((l) => ({
      connectionId: l.connection_id,
      storageClass: l.storage_class,
      state: l.state,
      archived: ARCHIVE_CLASSES.has(l.storage_class),
      restoreExpiresAt: l.restore_expires_at,
      size: l.size,
      updatedAt: l.updated_at,
    })),
    renditionDetails: renditions.results,
  })
})

assetRoutes.patch('/:id', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  if (!(await getAsset(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  try {
    const body = await readJsonObject(c)
    const text = (field: string, max: number): string | null | undefined => {
      const value = body[field]
      if (value === undefined) return undefined
      if (value === null || value === '') return null
      if (typeof value !== 'string' || value.length > max) throw new BadRequest(`${field} must be text up to ${max} characters.`)
      return value.trim()
    }
    const rating = body.rating
    if (rating !== undefined && rating !== null && !(Number.isInteger(rating) && (rating as number) >= 0 && (rating as number) <= 5)) {
      throw new BadRequest('rating is 0 to 5.')
    }
    await updateAsset(c.env.DB, id, {
      title: text('title', 300),
      caption: text('caption', 5000),
      alt: text('alt', 1000),
      rating: rating as number | null | undefined,
      tags: stringArray(body, 'tags'),
    })
    return c.json({ ok: true })
  } catch (error) {
    return storageFailure(c, error)
  }
})

assetRoutes.delete('/:id', requirePermission('assets:delete'), async (c) => {
  const id = c.req.param('id')
  if (!(await getAsset(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  await softDeleteAsset(c.env.DB, id)
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'asset.deleted', targetType: 'asset', targetId: id })
  return c.body(null, 204)
})

/** Thumbnails and previews: our own WebP, so always safe to show inline. */
assetRoutes.get('/:id/renditions/:name', requirePermission('assets:read'), async (c) => {
  const { id, name } = c.req.param()
  if (!isRenditionName(name)) return c.json({ error: 'not_found' }, 404)
  if (!(await getAsset(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  const object = await renditionStore(c.env).get(renditionKey(id, name))
  if (!object) return c.json({ error: 'not_found' }, 404)
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(object.size),
      'Cache-Control': 'private, max-age=86400',
      'Content-Disposition': 'inline',
    },
  })
})

/** The original file, always as a download. Archived originals must be restored first. */
assetRoutes.get('/:id/original', requirePermission('assets:read'), async (c) => {
  const id = c.req.param('id')
  const asset = await getAsset(c.env.DB, id)
  const location = asset && primaryLocation(await getLocations(c.env.DB, id))
  if (!asset || !location) return c.json({ error: 'not_found' }, 404)
  if (ARCHIVE_CLASSES.has(location.storage_class) && location.state !== 'restored') {
    return c.json({ error: 'archived', message: 'This original is in deep storage. Request a restore first.', storageClass: location.storage_class }, 409)
  }
  const connection = await getConnection(c.env.DB, location.connection_id)
  if (!connection) return c.json({ error: 'not_found' }, 404)
  try {
    const provider = providerFor(c.env, connection)
    if (provider.presignGet) {
      const signed = await provider.presignGet(location.key, { expiresSeconds: 300, downloadName: asset.filename })
      return c.redirect(signed.url, 302)
    }
    const object = await provider.get(location.key)
    if (!object) return c.json({ error: 'not_found' }, 404)
    return new Response(object.body, {
      headers: {
        'Content-Type': SAFE_INLINE_TYPES.has(asset.mime_type) ? asset.mime_type : 'application/octet-stream',
        'Content-Length': String(object.size),
        'Content-Disposition': attachmentDisposition(asset.filename),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    return storageFailure(c, error)
  }
})

async function locationFor(c: Context<DamEnv>, id: string) {
  const location = primaryLocation(await getLocations(c.env.DB, id))
  const connection = location && (await getConnection(c.env.DB, location.connection_id))
  if (!location || !connection) return null
  return { location, connection, provider: providerFor(c.env, connection) }
}

assetRoutes.post('/:id/storage-class', requirePermission('lifecycle:manage'), async (c) => {
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    const target = body.storageClass
    if (!isStorageClass(target)) throw new BadRequest('storageClass is not an S3 storage class.')
    const found = await locationFor(c, id)
    if (!found) return c.json({ error: 'not_found' }, 404)
    const { location, connection, provider } = found
    if (!provider.setStorageClass || !connection.storageClasses.includes(target)) {
      return c.json({ error: 'unsupported', message: `${connection.name} can't move objects to ${target}.` }, 409)
    }
    await provider.setStorageClass(location.key, target)
    const state = ARCHIVE_CLASSES.has(target) ? 'archived' : 'present'
    await c.env.DB.prepare('UPDATE asset_locations SET storage_class = ?, state = ?, restore_expires_at = NULL, updated_at = ? WHERE asset_id = ? AND connection_id = ?')
      .bind(target, state, nowIso(), id, location.connection_id).run()
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'asset.storage_class_changed', targetType: 'asset', targetId: id, details: { from: location.storage_class, to: target } })
    return c.json({ storageClass: target, state })
  } catch (error) {
    return storageFailure(c, error)
  }
})

assetRoutes.post('/:id/restore', requirePermission('lifecycle:manage'), async (c) => {
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    const days = body.days ?? 7
    const tier = (body.tier ?? 'Standard') as RestoreTier
    if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 30) throw new BadRequest('days is 1 to 30.')
    if (!RESTORE_TIERS.includes(tier)) throw new BadRequest(`tier is one of ${RESTORE_TIERS.join(', ')}.`)
    const found = await locationFor(c, id)
    if (!found) return c.json({ error: 'not_found' }, 404)
    const { location, provider } = found
    if (!ARCHIVE_CLASSES.has(location.storage_class) || !provider.restore) {
      return c.json({ error: 'not_archived', message: 'This original is not in deep storage.' }, 409)
    }
    const result = await provider.restore(location.key, { days: days as number, tier })
    await c.env.DB.prepare("UPDATE asset_locations SET state = 'restoring', updated_at = ? WHERE asset_id = ? AND connection_id = ?")
      .bind(nowIso(), id, location.connection_id).run()
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'asset.restore_requested', targetType: 'asset', targetId: id, details: { days, tier, result } })
    return c.json({ result, state: 'restoring' }, 202)
  } catch (error) {
    return storageFailure(c, error)
  }
})

/** Re-read the original's state from storage: finishes a restore, notices a lifecycle move. */
assetRoutes.post('/:id/refresh', requirePermission('assets:read'), async (c) => {
  const id = c.req.param('id')
  try {
    const found = await locationFor(c, id)
    if (!found) return c.json({ error: 'not_found' }, 404)
    const { location, provider } = found
    const head = await provider.head(location.key)
    if (!head) {
      await c.env.DB.prepare("UPDATE asset_locations SET state = 'gone', updated_at = ? WHERE asset_id = ? AND connection_id = ?")
        .bind(nowIso(), id, location.connection_id).run()
      return c.json({ state: 'gone' })
    }
    let state = 'present'
    if (ARCHIVE_CLASSES.has(head.storageClass)) {
      state = head.restore?.ongoing ? 'restoring' : head.restore?.expiresAt ? 'restored' : 'archived'
    }
    await c.env.DB.prepare('UPDATE asset_locations SET state = ?, storage_class = ?, restore_expires_at = ?, size = ?, updated_at = ? WHERE asset_id = ? AND connection_id = ?')
      .bind(state, head.storageClass, head.restore?.expiresAt ?? null, head.size, nowIso(), id, location.connection_id).run()
    return c.json({ state, storageClass: head.storageClass, restoreExpiresAt: head.restore?.expiresAt ?? null })
  } catch (error) {
    return storageFailure(c, error)
  }
})

/** Run processing again (metadata, renditions, index), e.g. after a restore. */
assetRoutes.post('/:id/reprocess', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  if (!(await getAsset(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  await c.env.DB.prepare("UPDATE assets SET status = 'processing', updated_at = ? WHERE id = ?").bind(nowIso(), id).run()
  c.executionCtx.waitUntil(processAsset(c.env, id))
  return c.json({ status: 'processing' }, 202)
})
