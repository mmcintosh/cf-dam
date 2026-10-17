import { Hono, type Context } from 'hono'
import { requirePermission } from '../auth/principal'
import { processAsset } from '../catalog/process'
import { isRenditionName, RenditionRejected, storeClientRendition, MAX_CLIENT_RENDITION_BYTES } from '../catalog/renditions'
import { abortUpload, completeUpload, createUpload, getUpload, partTargets, uploadProxiedPart, UploadError } from '../catalog/uploads'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, optionalString, readJsonObject, requiredString } from '../lib/http'
import { StorageError } from '../storage/types'

export const uploadRoutes = new Hono<DamEnv>()
uploadRoutes.use('*', requirePermission('assets:upload'))

function failure(c: Context<DamEnv>, error: unknown) {
  if (error instanceof UploadError) return c.json({ error: error.code, message: error.message }, error.status)
  if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
  if (error instanceof StorageError) return c.json({ error: 'storage_error', code: error.code, message: error.message }, 502)
  if (error instanceof RenditionRejected) return c.json({ error: 'invalid_rendition', message: error.message }, 400)
  throw error
}

uploadRoutes.post('/', async (c) => {
  try {
    const body = await readJsonObject(c)
    const size = body.size
    if (typeof size !== 'number') throw new BadRequest('size is required.')
    const result = await createUpload(c.env, c.get('principal')!, {
      filename: requiredString(body, 'filename', 255),
      size,
      contentType: optionalString(body, 'contentType', 100),
      sha256: optionalString(body, 'sha256', 64),
      connectionId: optionalString(body, 'connectionId', 64),
      storageClass: optionalString(body, 'storageClass', 32),
      allowDuplicate: body.allowDuplicate === true,
    })
    if ('duplicateOf' in result) return c.json({ error: 'duplicate', duplicateOf: result.duplicateOf }, 409)
    return c.json(result, 201)
  } catch (error) {
    return failure(c, error)
  }
})

uploadRoutes.post('/:id/part-urls', async (c) => {
  try {
    const upload = await getUpload(c.env.DB, c.get('principal')!, c.req.param('id'))
    const body = await readJsonObject(c)
    const numbers = body.partNumbers
    if (!Array.isArray(numbers) || !numbers.every((n) => Number.isInteger(n))) throw new BadRequest('partNumbers must be whole numbers.')
    return c.json({ parts: await partTargets(c.env, upload, numbers as number[]) })
  } catch (error) {
    return failure(c, error)
  }
})

uploadRoutes.put('/:id/parts/:part', async (c) => {
  try {
    const upload = await getUpload(c.env.DB, c.get('principal')!, c.req.param('id'))
    const length = Number(c.req.header('Content-Length'))
    if (!Number.isInteger(length) || length <= 0) throw new BadRequest('Content-Length is required.')
    const result = await uploadProxiedPart(c.env, upload, Number(c.req.param('part')), c.req.raw.body, length)
    // Same header a storage service returns, so clients handle both modes alike.
    return c.json(result, 200, { ETag: `"${result.etag}"` })
  } catch (error) {
    return failure(c, error)
  }
})

uploadRoutes.put('/:id/renditions/:name', async (c) => {
  try {
    const upload = await getUpload(c.env.DB, c.get('principal')!, c.req.param('id'))
    const name = c.req.param('name')
    if (!isRenditionName(name)) throw new BadRequest('Renditions are "thumb" or "preview".')
    const length = Number(c.req.header('Content-Length'))
    if (!Number.isInteger(length) || length <= 0 || length > MAX_CLIENT_RENDITION_BYTES) throw new BadRequest('That rendition is too large.')
    await storeClientRendition(c.env, upload.asset_id, name, await c.req.arrayBuffer())
    return c.body(null, 204)
  } catch (error) {
    return failure(c, error)
  }
})

uploadRoutes.post('/:id/complete', async (c) => {
  try {
    const principal = c.get('principal')!
    const upload = await getUpload(c.env.DB, principal, c.req.param('id'))
    const body = await readJsonObject(c)
    const parts = body.parts
    if (!Array.isArray(parts)) throw new BadRequest('parts is required.')
    const completed = parts.map((p: unknown) => {
      const part = p as { partNumber?: unknown; etag?: unknown }
      if (!Number.isInteger(part.partNumber) || typeof part.etag !== 'string' || part.etag === '') throw new BadRequest('Each part needs a partNumber and an etag.')
      return { partNumber: part.partNumber as number, etag: part.etag }
    })
    const assetId = await completeUpload(c.env, upload, completed)
    c.executionCtx.waitUntil(processAsset(c.env, assetId))
    await logActivity(c.env.DB, {
      userId: principal.userId,
      action: 'asset.uploaded',
      targetType: 'asset',
      targetId: assetId,
      details: { connection: upload.connection_id, storageClass: upload.storage_class, size: upload.size },
      ipAddress: c.req.header('cf-connecting-ip'),
    })
    return c.json({ assetId, status: 'processing' })
  } catch (error) {
    return failure(c, error)
  }
})

uploadRoutes.delete('/:id', async (c) => {
  try {
    await abortUpload(c.env, await getUpload(c.env.DB, c.get('principal')!, c.req.param('id')))
    return c.body(null, 204)
  } catch (error) {
    return failure(c, error)
  }
})
