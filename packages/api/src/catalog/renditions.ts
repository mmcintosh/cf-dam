/**
 * Thumbnails and previews, always WebP, always in the built-in R2 bucket, so they stay viewable
 * whatever tier the original is in. Only named sizes exist: arbitrary sizes would let anyone run
 * up transform costs (a finding from the Infowall audit).
 */
import type { DamBindings } from '../env'
import { nowIso } from '../lib/time'
import { renditionStore } from '../storage/connections'

export const RENDITIONS = {
  thumb: { longEdge: 480, quality: 78 },
  preview: { longEdge: 2048, quality: 82 },
} as const
export type RenditionName = keyof typeof RENDITIONS

export function isRenditionName(value: string): value is RenditionName {
  return value in RENDITIONS
}

/** Originals larger than this are not transformed in the Worker; the client or agent supplies previews. */
export const MAX_TRANSFORM_BYTES = 70 * 1024 * 1024
/** A client-supplied rendition may be at most this large. */
export const MAX_CLIENT_RENDITION_BYTES = 4 * 1024 * 1024

export const renditionKey = (assetId: string, name: RenditionName) => `renditions/${assetId}/${name}.webp`

async function store(
  env: DamBindings,
  assetId: string,
  name: RenditionName,
  bytes: ArrayBuffer,
  mimeType: string,
  dims: { width: number | null; height: number | null },
  source: 'worker' | 'client' | 'embedded',
): Promise<void> {
  await renditionStore(env).put(renditionKey(assetId, name), bytes, { contentType: mimeType })
  await env.DB.prepare(
    `INSERT INTO renditions (asset_id, name, key, mime_type, width, height, size, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (asset_id, name) DO UPDATE SET key = excluded.key, mime_type = excluded.mime_type,
       width = excluded.width, height = excluded.height, size = excluded.size, source = excluded.source,
       created_at = excluded.created_at`,
  )
    .bind(assetId, name, renditionKey(assetId, name), mimeType, dims.width, dims.height, bytes.byteLength, source, nowIso())
    .run()
}

async function transform(images: ImagesBinding, input: ReadableStream, name: RenditionName) {
  const { longEdge, quality } = RENDITIONS[name]
  const result = await images
    .input(input)
    .transform({ width: longEdge, height: longEdge, fit: 'scale-down' })
    .output({ format: 'image/webp', quality })
  const bytes = await result.response().arrayBuffer()
  const info = await images.info(new Blob([bytes]).stream())
  const dims = 'width' in info ? { width: info.width, height: info.height } : { width: null, height: null }
  return { bytes, dims }
}

/**
 * Make the preview from the original, then the thumbnail from the preview (cheaper than reading
 * the original twice). Returns the original's dimensions when Images could read them.
 */
export async function generateRenditions(
  env: DamBindings,
  assetId: string,
  original: ReadableStream,
): Promise<{ width: number; height: number } | null> {
  const images = env.IMAGES
  if (!images) return null
  const [forInfo, forPreview] = original.tee()
  const infoPromise = images.info(forInfo).catch(() => null)
  const preview = await transform(images, forPreview, 'preview')
  await store(env, assetId, 'preview', preview.bytes, 'image/webp', preview.dims, 'worker')
  const thumb = await transform(images, new Blob([preview.bytes]).stream(), 'thumb')
  await store(env, assetId, 'thumb', thumb.bytes, 'image/webp', thumb.dims, 'worker')
  const info = await infoPromise
  return info && 'width' in info ? { width: info.width, height: info.height } : null
}

/** A thumbnail from the small JPEG embedded in many camera files (RAW included). */
export async function storeEmbeddedThumbnail(env: DamBindings, assetId: string, jpeg: Uint8Array): Promise<boolean> {
  const images = env.IMAGES
  if (!images) return false
  try {
    const thumb = await transform(images, new Blob([new Uint8Array(jpeg)]).stream(), 'thumb')
    await store(env, assetId, 'thumb', thumb.bytes, 'image/webp', thumb.dims, 'embedded')
    return true
  } catch {
    return false
  }
}

export class RenditionRejected extends Error {}

/**
 * A rendition made by the browser or NAS agent, for originals the Worker can't read (archived on
 * arrival, too large, or a format Images can't decode). It is decoded and re-encoded through Images
 * where available, so what we store and serve is always an image we produced.
 */
export async function storeClientRendition(env: DamBindings, assetId: string, name: RenditionName, bytes: ArrayBuffer): Promise<void> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CLIENT_RENDITION_BYTES) {
    throw new RenditionRejected(`A ${name} must be between 1 byte and ${MAX_CLIENT_RENDITION_BYTES / 1024 / 1024} MB.`)
  }
  const images = env.IMAGES
  if (!images) throw new RenditionRejected('This deployment has no Images binding to verify uploaded previews.')
  try {
    const result = await transform(images, new Blob([bytes]).stream(), name)
    await store(env, assetId, name, result.bytes, 'image/webp', result.dims, 'client')
  } catch {
    throw new RenditionRejected(`The ${name} is not an image that can be decoded.`)
  }
}

export async function hasRendition(db: D1Database, assetId: string, name: RenditionName): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS present FROM renditions WHERE asset_id = ? AND name = ?').bind(assetId, name).first()) !== null
}
