import { Hono, type Context } from 'hono'
import { requirePermission } from '../auth/principal'
import { assetJson, getAsset, isLabel, LABELS, type Label, getLocations, getTags, listAssets, parseListFilters, primaryLocation, softDeleteAsset, updateAsset } from '../catalog/assets'
import { parseIptcPatch, type IptcValues } from '../catalog/iptc'
import { exportKeywords } from '../catalog/keywords'
import { applyBulk, BULK_PERMISSION, facets, getLabelNames, geoPoints, MAX_BULK, sidecarName, timeline, xmpSidecar, type BulkAction } from '../catalog/library'
import { SAFE_INLINE_TYPES } from '../catalog/metadata'
import { acceptSuggestions, analyzeAsset, removeAiTag, type AcceptField } from '../catalog/ai'
import { fillPlacesFromGps } from '../catalog/places'
import { processAsset } from '../catalog/process'
import { indexAsset } from '../catalog/search'
import { isRenditionName, renditionKey } from '../catalog/renditions'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject, stringArray } from '../lib/http'
import { nowIso } from '../lib/time'
import { getConnection, providerFor, renditionStore } from '../storage/connections'
import { ARCHIVE_CLASSES, attachmentDisposition, isStorageClass, RESTORE_TIERS, StorageError, type RestoreTier } from '../storage/types'

export const assetRoutes = new Hono<DamEnv>()

const PLAYABLE_VIDEO: ReadonlySet<string> = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])

function storageFailure(c: Context<DamEnv>, error: unknown) {
  if (error instanceof StorageError) {
    // 404 and 409 (e.g. the original is on a NAS) are answers about the request; anything else is the store failing.
    return c.json({ error: 'storage_error', code: error.code, message: error.message }, error.status === 404 || error.status === 409 ? error.status : 502)
  }
  if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
  throw error
}

assetRoutes.get('/', requirePermission('assets:read'), async (c) => c.json(await listAssets(c.env.DB, parseListFilters(c.req.query()))))

assetRoutes.get('/facets', requirePermission('assets:read'), async (c) => c.json(await facets(c.env.DB, parseListFilters(c.req.query()))))

assetRoutes.get('/timeline', requirePermission('assets:read'), async (c) =>
  c.json({ months: await timeline(c.env.DB, parseListFilters(c.req.query())) }),
)

assetRoutes.get('/geo', requirePermission('assets:read'), async (c) =>
  c.json({ points: await geoPoints(c.env.DB, parseListFilters(c.req.query())) }),
)

/** One action on up to 500 assets. The permission depends on the action. */
assetRoutes.post('/bulk', requirePermission('assets:read'), async (c) => {
  const principal = c.get('principal')!
  try {
    const body = await readJsonObject(c)
    const ids = stringArray(body, 'ids') ?? []
    if (ids.length === 0 || ids.length > MAX_BULK) throw new BadRequest(`Choose between 1 and ${MAX_BULK} assets.`)
    const action = body.action
    let bulk: BulkAction
    switch (action) {
      case 'tag-add':
      case 'tag-remove': {
        const tags = stringArray(body, 'tags') ?? []
        if (tags.length === 0) throw new BadRequest('tags is required.')
        bulk = { action, tags }
        break
      }
      case 'rating': {
        const rating = body.rating
        if (rating !== null && !(Number.isInteger(rating) && (rating as number) >= 0 && (rating as number) <= 5)) throw new BadRequest('rating is 0 to 5, or null.')
        bulk = { action, rating: rating as number | null }
        break
      }
      case 'flag': {
        const flag = body.flag
        if (flag !== null && flag !== 'pick' && flag !== 'reject') throw new BadRequest('flag is pick, reject or null.')
        bulk = { action, flag }
        break
      }
      case 'label': {
        const label = body.label
        if (label !== null && !isLabel(label)) throw new BadRequest(`label is one of ${LABELS.join(', ')}, or null.`)
        bulk = { action, label }
        break
      }
      case 'gps': {
        const { lat, lng } = body
        const valid = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max
        if (lat === null && lng === null) bulk = { action, lat: null, lng: null }
        else if (valid(lat, 90) && valid(lng, 180)) bulk = { action, lat: Math.round((lat as number) * 1e7) / 1e7, lng: Math.round((lng as number) * 1e7) / 1e7 }
        else throw new BadRequest('lat and lng are degrees (−90…90, −180…180), or both null.')
        break
      }
      case 'preset': {
        if (typeof body.presetId !== 'string') throw new BadRequest('presetId is required.')
        bulk = { action, presetId: body.presetId, overwrite: body.overwrite === true }
        break
      }
      case 'title':
      case 'caption': {
        const value = body[action]
        if (value !== null && (typeof value !== 'string' || value.length > 5000)) throw new BadRequest(`${action} must be text.`)
        bulk = action === 'title' ? { action, title: value as string | null } : { action, caption: value as string | null }
        break
      }
      case 'album-add': {
        const albumId = body.albumId
        if (typeof albumId !== 'string' || !(await c.env.DB.prepare('SELECT 1 FROM albums WHERE id = ?').bind(albumId).first())) {
          throw new BadRequest('albumId must be an existing album.')
        }
        bulk = { action, albumId }
        break
      }
      case 'delete':
      case 'ai-queue':
        bulk = { action }
        break
      case 'ai-accept':
        bulk = { action, fields: acceptFields(body.fields), overwrite: body.overwrite === true }
        break
      default:
        throw new BadRequest('Unknown action.')
    }
    const needed = BULK_PERMISSION[bulk.action]
    if (!principal.permissions.has(needed)) return c.json({ error: 'forbidden', permission: needed }, 403)
    const changed = await applyBulk(c.env.DB, ids, bulk)
    if (bulk.action === 'gps' && bulk.lat !== null) {
      await fillPlacesFromGps(c.env, ids)
      for (const id of ids.slice(0, MAX_BULK)) await indexAsset(c.env.DB, id)
    }
    await logActivity(c.env.DB, { userId: principal.userId, action: `asset.bulk_${bulk.action}`, targetType: 'asset', details: { count: changed } })
    return c.json({ changed })
  } catch (error) {
    return storageFailure(c, error)
  }
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
    const flag = body.flag
    if (flag !== undefined && flag !== null && flag !== 'pick' && flag !== 'reject') throw new BadRequest('flag is pick, reject or null.')
    const label = body.label
    if (label !== undefined && label !== null && !isLabel(label)) throw new BadRequest(`label is one of ${LABELS.join(', ')}, or null.`)
    const filename = body.filename
    if (filename !== undefined && (typeof filename !== 'string' || !/^[^\\/\u0000-\u001f]{1,200}$/.test(filename.trim()))) {
      throw new BadRequest('filename must be 1–200 characters with no slashes.')
    }
    await updateAsset(c.env.DB, id, {
      flag: flag as 'pick' | 'reject' | null | undefined,
      label: label as Label | null | undefined,
      filename: typeof filename === 'string' ? filename.trim() : undefined,
      title: text('title', 300),
      caption: text('caption', 5000),
      alt: text('alt', 1000),
      rating: rating as number | null | undefined,
      tags: stringArray(body, 'tags'),
      iptc: iptcPatch(body.iptc),
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

/** An XMP sidecar named to pair with the original, so Lightroom and friends pick up the metadata. */
assetRoutes.get('/:id/xmp', requirePermission('assets:read'), async (c) => {
  const id = c.req.param('id')
  const row = await getAsset(c.env.DB, id)
  if (!row) return c.json({ error: 'not_found' }, 404)
  const [keywords, labelNames] = await Promise.all([exportKeywords(c.env.DB, id), getLabelNames(c.env.DB)])
  return new Response(xmpSidecar(row, keywords, labelNames), {
    headers: {
      'Content-Type': 'application/rdf+xml; charset=utf-8',
      'Content-Disposition': attachmentDisposition(sidecarName(row.filename)),
      'Cache-Control': 'private, no-store',
    },
  })
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
    // Byte ranges let a <video> seek without downloading the whole file first.
    const range = /^bytes=(\d+)-(\d*)$/.exec(c.req.header('Range') ?? '')
    const start = range ? Number(range[1]) : null
    const end = range?.[2] ? Number(range[2]) : null
    if (start !== null && (start >= asset.size || (end !== null && end < start))) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${asset.size}` } })
    }
    const object = await provider.get(location.key, start === null ? undefined : { offset: start, length: (end === null ? asset.size - 1 : Math.min(end, asset.size - 1)) - start + 1 })
    if (!object) return c.json({ error: 'not_found' }, 404)
    return new Response(object.body, {
      status: start === null ? 200 : 206,
      headers: {
        // Video can't run script, so it gets its real type (for <video>); other unsafe types stay opaque.
        'Content-Type': SAFE_INLINE_TYPES.has(asset.mime_type) || PLAYABLE_VIDEO.has(asset.mime_type) ? asset.mime_type : 'application/octet-stream',
        'Content-Length': String(object.size),
        'Accept-Ranges': 'bytes',
        ...(start !== null ? { 'Content-Range': `bytes ${start}-${start + object.size - 1}/${asset.size}` } : {}),
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

function iptcPatch(value: unknown): IptcValues | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BadRequest('iptc must be an object.')
  try {
    return parseIptcPatch(value as Record<string, unknown>)
  } catch (error) {
    throw new BadRequest(error instanceof Error ? error.message : 'Invalid iptc.')
  }
}

const ACCEPT_FIELDS: readonly AcceptField[] = ['alt', 'caption', 'tags']

function acceptFields(value: unknown): AcceptField[] {
  if (value === undefined) return [...ACCEPT_FIELDS]
  if (!Array.isArray(value) || value.length === 0 || !value.every((f) => ACCEPT_FIELDS.includes(f))) {
    throw new BadRequest('fields is a list of alt, caption and tags.')
  }
  return [...new Set(value as AcceptField[])]
}

/** Analyse one photo now (a few seconds) instead of waiting for the sweep. */
assetRoutes.post('/:id/ai/analyze', requirePermission('ai:run'), async (c) => {
  const id = c.req.param('id')
  if (!(await getAsset(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  if (!c.env.AI) return c.json({ error: 'ai_unavailable', message: 'This deployment has no Workers AI binding.' }, 409)
  const outcome = await analyzeAsset(c.env, id)
  const row = (await getAsset(c.env.DB, id))!
  return c.json({ outcome, ai: assetJson(row, []).ai, tags: await getTags(c.env.DB, id) }, outcome === 'failed' ? 502 : 200)
})

/** Accept the AI's alt text, caption and/or tags. Alt and caption fill empty fields unless overwrite is set. */
assetRoutes.post('/:id/ai/accept', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  if (!(await getAsset(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  try {
    const body = await readJsonObject(c)
    await acceptSuggestions(c.env.DB, [id], acceptFields(body.fields), body.overwrite === true)
    const row = (await getAsset(c.env.DB, id))!
    return c.json({ alt: row.alt, caption: row.caption, tags: await getTags(c.env.DB, id) })
  } catch (error) {
    return storageFailure(c, error)
  }
})

assetRoutes.delete('/:id/ai/tags/:tag', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  if (!(await getAsset(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  await removeAiTag(c.env.DB, id, decodeURIComponent(c.req.param('tag')))
  return c.json({ tags: await getTags(c.env.DB, id) })
})

/** Run processing again (metadata, renditions, index), e.g. after a restore. */
assetRoutes.post('/:id/reprocess', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  if (!(await getAsset(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  await c.env.DB.prepare("UPDATE assets SET status = 'processing', updated_at = ? WHERE id = ?").bind(nowIso(), id).run()
  c.executionCtx.waitUntil(processAsset(c.env, id))
  return c.json({ status: 'processing' }, 202)
})
