import { Hono, type Context } from 'hono'
import { countedImages } from '../lib/images'
import { requirePermission } from '../auth/principal'
import { assetJson, getAsset, isLabel, LABELS, type Label, getLocations, getTags, listAssets, parseListFilters, primaryLocation, readableNow, softDeleteAsset, updateAsset } from '../catalog/assets'
import { parseIptcPatch, type IptcValues } from '../catalog/iptc'
import { exportKeywords } from '../catalog/keywords'
import { applyBulk, BULK_PERMISSION, facets, getLabelNames, geoPoints, MAX_BULK, sidecarName, timeline, xmpSidecar, type BulkAction } from '../catalog/library'
import { acceptSuggestions, aiOff, aiAvailable, analyzeAsset, claimForAi, removeAiTag, type AcceptField } from '../catalog/ai'
import { resolveNear } from '../catalog/meaning'
import { nudge } from '../catalog/work'
import { fillPlacesFromGps } from '../catalog/places'
import { processAsset } from '../catalog/process'
import { indexAssets } from '../catalog/search'
import { baseKey, editImage, parseEdit, readEdit } from '../catalog/edits'
import { RENDERABLE_TYPES } from '../catalog/metadata'
import { noteMissing, readableLocation } from '../catalog/previews'
import { applyEdit, isRenditionName, MAX_TRANSFORM_BYTES, renditionKey } from '../catalog/renditions'
import { isDownloadSize, JPEG_LONG_EDGE } from '../catalog/shares'
import { galleryImage, getWatermark } from '../catalog/watermark'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject, stringArray } from '../lib/http'
import { nowIso } from '../lib/time'
import { getConnection, providerFor, renditionStore } from '../storage/connections'
import { originalResponse } from '../storage/original'
import { ARCHIVE_CLASSES, attachmentDisposition, isStorageClass, RESTORE_TIERS, StorageError, type RestoreTier } from '../storage/types'
import { say } from '../lib/language'

export const assetRoutes = new Hono<DamEnv>()

function storageFailure(c: Context<DamEnv>, error: unknown) {
  if (error instanceof StorageError) {
    // 404 and 409 (e.g. the original is on a NAS) are answers about the request; anything else is the store failing.
    return c.json({ error: 'storage_error', code: error.code, message: error.message }, error.status === 404 || error.status === 409 ? error.status : 502)
  }
  if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
  throw error
}

/** Library filters, with a search by meaning looked up (catalog/meaning.ts). */
const filtersOf = (c: Context<DamEnv>) => resolveNear(c.env, parseListFilters(c.req.query()))

assetRoutes.get('/', requirePermission('assets:read'), async (c) => c.json(await listAssets(c.env.DB, await filtersOf(c))))

assetRoutes.get('/facets', requirePermission('assets:read'), async (c) => c.json(await facets(c.env.DB, await filtersOf(c))))

assetRoutes.get('/timeline', requirePermission('assets:read'), async (c) =>
  c.json({ months: await timeline(c.env.DB, await filtersOf(c)) }),
)

assetRoutes.get('/geo', requirePermission('assets:read'), async (c) =>
  c.json({ points: await geoPoints(c.env.DB, await filtersOf(c)) }),
)

/** One action on up to 500 assets. The permission depends on the action. */
assetRoutes.post('/bulk', requirePermission('assets:read'), async (c) => {
  const principal = c.get('principal')!
  try {
    const body = await readJsonObject(c)
    const ids = stringArray(body, 'ids') ?? []
    if (ids.length === 0 || ids.length > MAX_BULK) throw new BadRequest(say('err.chooseAssets', { max: MAX_BULK }))
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
    if (bulk.action === 'ai-queue' && !(await aiAvailable(c.env))) return c.json({ error: 'ai_off', message: c.env.AI ? aiOff() : say('err.noAi') }, 409)
    const changed = await applyBulk(c.env.DB, ids, bulk)
    if (bulk.action === 'ai-queue') await nudge(c.env, 'ai', changed)
    if (bulk.action === 'gps') {
      if (bulk.lat !== null) await fillPlacesFromGps(c.env, ids.slice(0, MAX_BULK))
      await indexAssets(c.env.DB, ids.slice(0, MAX_BULK))
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
      throw new BadRequest(say('err.filename'))
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
  // `?base=1`: the picture before its edit, for drawing a new one (the rendition itself when unedited).
  const base = c.req.query('base') === '1' && name !== 'sheet' ? await renditionStore(c.env).get(baseKey(id, name)) : null
  const object = base ?? (await renditionStore(c.env).get(renditionKey(id, name)))
  if (!object) {
    // Listed but not in R2 (after a restore into a new account, say): have it made again.
    c.executionCtx.waitUntil(noteMissing(c.env.DB, id, name).catch((error) => console.warn('[previews] could not note a missing one', id, error)))
    return c.json({ error: 'not_found' }, 404)
  }
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(object.size),
      // Addresses with `?v=` (the photo's imageVersion) change with each edit; the rest are checked again
      // after ten minutes, so an edited photo shows everywhere soon.
      'Cache-Control': c.req.query('v') && !base ? 'private, max-age=86400' : base ? 'private, no-store' : 'private, max-age=600, stale-while-revalidate=86400',
      'Content-Disposition': 'inline',
    },
  })
})

/**
 * Rotate, mirror and crop (catalog/edits.ts), or `{ "edit": null }` to undo. The original is never
 * touched: the thumbnail and preview are made again from the unedited ones.
 */
assetRoutes.put('/:id/edit', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  const asset = await getAsset(c.env.DB, id)
  if (!asset) return c.json({ error: 'not_found' }, 404)
  if (asset.mime_type.startsWith('video/')) return c.json({ error: 'unsupported', message: say('err.videoEdit') }, 409)
  if (!c.env.IMAGES) return c.json({ error: 'unsupported', message: say('err.noImages') }, 409)
  let edit
  try {
    edit = parseEdit((await readJsonObject(c)).edit)
  } catch (error) {
    return c.json({ error: 'invalid_request', message: error instanceof Error ? error.message : 'Not an edit.' }, 400)
  }
  const before = asset.edit ?? null
  const save = (value: string | null) =>
    c.env.DB.prepare('UPDATE assets SET edit = ?, edited_at = ?, updated_at = ? WHERE id = ?').bind(value, nowIso(), nowIso(), id).run()
  await save(edit && JSON.stringify(edit))
  try {
    await applyEdit(c.env, id)
  } catch (error) {
    console.warn('[edits] could not apply', id, error)
    await save(before)
    await applyEdit(c.env, id).catch(() => {})
    return c.json({ error: 'edit_failed', message: say('err.editFailed') }, 502)
  }
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: edit ? 'asset.edited' : 'asset.edit_undone', targetType: 'asset', targetId: id, details: { edit } })
  const updated = (await getAsset(c.env.DB, id))!
  const json = assetJson(updated, [])
  return c.json({ edit: json.edit, imageVersion: json.imageVersion, displayWidth: json.displayWidth, displayHeight: json.displayHeight })
})

/** The sizes a copy can be downloaded in, for the page to offer. */
assetRoutes.get('/:id/download', requirePermission('assets:read'), async (c) => {
  const id = c.req.param('id')
  const asset = await getAsset(c.env.DB, id)
  if (!asset) return c.json({ error: 'not_found' }, 404)
  const watermark = await getWatermark(c.env.DB)
  return c.json({ sizes: copySizes(asset, await getLocations(c.env.DB, id)), watermark: watermark.version !== null })
})

const copySizes = (asset: NonNullable<Awaited<ReturnType<typeof getAsset>>>, locations: Awaited<ReturnType<typeof getLocations>>) => {
  if (asset.mime_type.startsWith('video/')) return []
  const full = RENDERABLE_TYPES.has(asset.mime_type) && asset.size <= MAX_TRANSFORM_BYTES && readableLocation(locations) !== null
  return full ? ['small', 'large', 'full', 'cutout'] : ['small', 'large', 'cutout']
}

/**
 * A JPEG copy, edit applied: `small` (1024 px) or `large` (2048 px) from the preview, watermarked with
 * `?watermark=1`; `full` from the original, when the Worker can read it and Images can decode it.
 * `cutout`: the preview with its background removed (Images' `segment`), a PNG with transparency.
 */
assetRoutes.get('/:id/download/:size', requirePermission('assets:read'), async (c) => {
  const { id, size } = c.req.param()
  const asset = await getAsset(c.env.DB, id)
  if (!asset) return c.json({ error: 'not_found' }, 404)
  const locations = await getLocations(c.env.DB, id)
  if (!copySizes(asset, locations).includes(size)) return c.json({ error: 'unavailable', message: say('err.sizeUnavailable') }, 409)
  const name = `${asset.filename.replace(/\.[^.]*$/, '') || 'photo'}-${size}.${size === 'cutout' ? 'png' : 'jpg'}`
  const headers = (length: number) => ({
    'Content-Type': size === 'cutout' ? 'image/png' : 'image/jpeg',
    'Content-Length': String(length),
    'Content-Disposition': attachmentDisposition(name),
    'Cache-Control': 'private, no-store',
  })
  if (isDownloadSize(size) && size !== 'original') {
    const image = await galleryImage(c.env, id, size, { watermark: c.req.query('watermark') === '1', longEdge: JPEG_LONG_EDGE[size] })
    if (!image) return c.json({ error: 'unavailable', message: say('err.noPreviewCopy') }, 409)
    return new Response(image.body, { headers: headers(image.size) })
  }
  const images = countedImages(c.env)
  if (size === 'cutout') {
    const preview = (await renditionStore(c.env).get(renditionKey(id, 'preview'))) ?? (await renditionStore(c.env).get(renditionKey(id, 'thumb')))
    if (!images || !preview) return c.json({ error: 'unavailable', message: say('err.noPreviewCutout') }, 409)
    try {
      const png = await (await images.input(preview.body).transform({ segment: 'foreground' }).output({ format: 'image/png' })).response().arrayBuffer()
      return new Response(png, { headers: headers(png.byteLength) })
    } catch (error) {
      console.warn('[download] cut-out failed', id, error)
      return c.json({ error: 'download_failed', message: say('err.cutoutFailed') }, 502)
    }
  }
  const location = readableLocation(locations)
  const connection = location && (await getConnection(c.env.DB, location.connection_id))
  if (!images || !location || !connection) return c.json({ error: 'unavailable', message: say('err.originalUnreadable') }, 409)
  try {
    const original = await providerFor(c.env, connection).get(location.key)
    if (!original) return c.json({ error: 'not_found', message: say('err.originalMissing') }, 404)
    const edit = readEdit(asset.edit)
    let bytes: ArrayBuffer
    if (!edit) {
      bytes = await (await images.input(original.body).output({ format: 'image/jpeg', quality: 92 })).response().arrayBuffer()
    } else {
      // Rotated and mirrored first, to learn the exact size the crop is drawn on (EXIF orientation applied).
      let turned = await (await editImage(images, original.body, { width: 1, height: 1 }, { ...edit, crop: null }).image.output({ format: 'image/jpeg', quality: 95 })).response().arrayBuffer()
      if (edit.crop) {
        const info = await images.info(new Blob([turned]).stream())
        if (!('width' in info)) throw new Error('Images could not read the turned original.')
        const cropped = editImage(images, new Blob([turned]).stream(), { width: info.width, height: info.height }, { rotate: 0, mirror: false, crop: edit.crop })
        turned = await (await cropped.image.output({ format: 'image/jpeg', quality: 92 })).response().arrayBuffer()
      }
      bytes = turned
    }
    return new Response(bytes, { headers: headers(bytes.byteLength) })
  } catch (error) {
    if (error instanceof StorageError) return storageFailure(c, error)
    console.warn('[download] full size failed', id, error)
    return c.json({ error: 'download_failed', message: say('err.fullSizeFailed') }, 502)
  }
})

/** The original file, always as a download. Archived originals must be restored first. */
assetRoutes.get('/:id/original', requirePermission('assets:read'), async (c) => {
  const id = c.req.param('id')
  const asset = await getAsset(c.env.DB, id)
  const location = asset && primaryLocation(await getLocations(c.env.DB, id))
  if (!asset || !location) return c.json({ error: 'not_found' }, 404)
  if (!readableNow(location)) {
    return c.json({ error: 'archived', message: say('err.archived'), storageClass: location.storage_class }, 409)
  }
  try {
    return (await originalResponse(c.env, c.req.raw, asset, location)) ?? c.json({ error: 'not_found' }, 404)
  } catch (error) {
    return storageFailure(c, error)
  }
})

/**
 * The S3 copy of an original, which restores, class changes and refreshes act on (never a NAS or R2 copy): a cold
 * one first, or the one in `connectionId`.
 */
async function s3LocationFor(c: Context<DamEnv>, id: string, connectionId?: string) {
  const locations = (await getLocations(c.env.DB, id))
    .filter((l) => l.state !== 'pending' && l.state !== 'gone' && (!connectionId || l.connection_id === connectionId))
    .sort((a, b) => Number(ARCHIVE_CLASSES.has(b.storage_class)) - Number(ARCHIVE_CLASSES.has(a.storage_class)))
  for (const location of locations) {
    const connection = await getConnection(c.env.DB, location.connection_id)
    if (connection?.provider === 's3') return { location, connection, provider: providerFor(c.env, connection) }
  }
  return null
}

const optionalConnection = (body: Record<string, unknown>) => (typeof body.connectionId === 'string' ? body.connectionId : undefined)

/** A restore is looked at again this long after it's asked for, and between looks. */
const RESTORE_CHECK_MS = 20 * 60_000

assetRoutes.post('/:id/storage-class', requirePermission('lifecycle:manage'), async (c) => {
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    const target = body.storageClass
    if (!isStorageClass(target)) throw new BadRequest('storageClass is not an S3 storage class.')
    const found = await s3LocationFor(c, id, optionalConnection(body))
    if (!found) return c.json({ error: 'not_found' }, 404)
    const { location, connection, provider } = found
    if (!provider.setStorageClass || !connection.storageClasses.includes(target)) {
      return c.json({ error: 'unsupported', message: `${connection.name} can't move objects to ${target}.` }, 409)
    }
    await provider.setStorageClass(location.key, target)
    const state = ARCHIVE_CLASSES.has(target) ? 'archived' : 'present'
    // The copy in place gives the object a new ETag: keep it, or the storage checks report the original as changed.
    const head = await provider.head(location.key)
    await c.env.DB.prepare('UPDATE asset_locations SET storage_class = ?, state = ?, restore_expires_at = NULL, next_check_at = NULL, etag = COALESCE(?, etag), size = COALESCE(?, size), updated_at = ? WHERE asset_id = ? AND connection_id = ?')
      .bind(target, state, head?.etag ?? null, head?.size ?? null, nowIso(), id, location.connection_id).run()
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
    const found = await s3LocationFor(c, id, optionalConnection(body))
    if (!found) return c.json({ error: 'not_found' }, 404)
    const { location, provider } = found
    if (!ARCHIVE_CLASSES.has(location.storage_class) || !provider.restore) {
      return c.json({ error: 'not_archived', message: say('err.notArchived') }, 409)
    }
    const result = await provider.restore(location.key, { days: days as number, tier })
    await c.env.DB.prepare("UPDATE asset_locations SET state = 'restoring', next_check_at = ?, updated_at = ? WHERE asset_id = ? AND connection_id = ?")
      .bind(new Date(Date.now() + RESTORE_CHECK_MS).toISOString(), nowIso(), id, location.connection_id).run()
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
    const found = await s3LocationFor(c, id, c.req.query('connectionId'))
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
    await c.env.DB.prepare('UPDATE asset_locations SET state = ?, storage_class = ?, restore_expires_at = ?, size = ?, next_check_at = NULL, updated_at = ? WHERE asset_id = ? AND connection_id = ?')
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
  if (!c.env.AI) return c.json({ error: 'ai_unavailable', message: say('err.noAi') }, 409)
  if (!(await claimForAi(c.env.DB, id))) return c.json({ error: 'busy', message: say('err.aiBusy') }, 409)
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
  // Hono has already decoded the parameter: decoding again turned '%' into a 500.
  await removeAiTag(c.env.DB, id, c.req.param('tag'))
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
