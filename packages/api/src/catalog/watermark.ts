/**
 * Watermarks for client galleries, and the gallery images made from our own previews.
 *
 * There is one watermark per installation: a PNG (made from text in the browser, or someone's logo),
 * re-encoded through Images on the way in so we only ever draw an image we produced. Watermarked
 * views and JPEG downloads are made once with the Images binding and kept in R2 under a key naming
 * the watermark version and the preview they were made from, so a gallery viewed many times costs
 * one transform per photo and size, and a new watermark or a re-made preview is never served stale.
 * JPEG downloads get the photographer's credit written in as they're sent (storage/clean.ts creditJpeg).
 */
import { countedImages } from '../lib/images'
import type { DamBindings } from '../env'
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { creditJpeg, type Credit } from '../storage/clean'
import { renditionStore } from '../storage/connections'
import { renditionKey, type RenditionName } from './renditions'

export const WATERMARK_POSITIONS = ['center', 'bottom-right', 'bottom-left', 'tiled'] as const
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number]

export interface WatermarkSettings {
  /** Changes with every new image; null when no watermark image has been set. */
  version: string | null
  position: WatermarkPosition
  /** Width of the watermark as a share of the photo's width (tiled: of each tile). */
  scale: number
  opacity: number
}

const DEFAULTS: WatermarkSettings = { version: null, position: 'center', scale: 0.4, opacity: 0.5 }
/** An uploaded watermark may be at most this large. */
export const MAX_WATERMARK_BYTES = 2 * 1024 * 1024

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

export async function getWatermark(db: D1Database): Promise<WatermarkSettings> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'watermark'").first<{ value: string }>()
  try {
    const saved = JSON.parse(row?.value ?? '{}') as Record<string, unknown>
    return {
      version: typeof saved.version === 'string' && /^[0-9a-f]{32}$/.test(saved.version) ? saved.version : null,
      position: (WATERMARK_POSITIONS as readonly unknown[]).includes(saved.position) ? (saved.position as WatermarkPosition) : DEFAULTS.position,
      scale: clamp(saved.scale, 0.05, 1, DEFAULTS.scale),
      opacity: clamp(saved.opacity, 0.05, 1, DEFAULTS.opacity),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

async function saveWatermark(db: D1Database, settings: WatermarkSettings): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('watermark', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(JSON.stringify(settings), nowIso())
    .run()
}

/**
 * Change placement, size or opacity. That changes how every watermarked image looks, so it takes a
 * new version (the image itself is copied under it) and the old cached images are dropped.
 */
export async function updateWatermark(env: DamBindings, patch: Partial<Omit<WatermarkSettings, 'version'>>): Promise<WatermarkSettings> {
  const current = await getWatermark(env.DB)
  const next: WatermarkSettings = {
    version: current.version,
    position: patch.position && (WATERMARK_POSITIONS as readonly string[]).includes(patch.position) ? patch.position : current.position,
    scale: clamp(patch.scale, 0.05, 1, current.scale),
    opacity: clamp(patch.opacity, 0.05, 1, current.opacity),
  }
  if (current.version && (next.position !== current.position || next.scale !== current.scale || next.opacity !== current.opacity)) {
    const image = await renditionStore(env).get(watermarkKey(current.version))
    if (image) {
      next.version = randomId()
      await renditionStore(env).put(watermarkKey(next.version), await new Response(image.body).arrayBuffer(), { contentType: 'image/png' })
    }
  }
  await saveWatermark(env.DB, next)
  return next
}

export class WatermarkRejected extends Error {}

/** Set the watermark image. It is decoded and re-encoded as PNG (keeping transparency) through Images. */
export async function setWatermarkImage(env: DamBindings, bytes: ArrayBuffer): Promise<WatermarkSettings> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_WATERMARK_BYTES) throw new WatermarkRejected('A watermark must be an image of at most 2 MB.')
  const images = countedImages(env)
  if (!images) throw new WatermarkRejected('This deployment has no Images binding, so it cannot make watermarks.')
  let png: ArrayBuffer
  try {
    const result = await images.input(new Blob([bytes]).stream()).transform({ width: 2000, height: 2000, fit: 'scale-down' }).output({ format: 'image/png' })
    png = await result.response().arrayBuffer()
  } catch {
    throw new WatermarkRejected('That file is not an image that can be read.')
  }
  const current = await getWatermark(env.DB)
  const next = { ...current, version: randomId() }
  await renditionStore(env).put(watermarkKey(next.version), png, { contentType: 'image/png' })
  await saveWatermark(env.DB, next)
  return next
}

export async function removeWatermarkImage(db: D1Database): Promise<WatermarkSettings> {
  const next = { ...(await getWatermark(db)), version: null }
  await saveWatermark(db, next)
  return next
}

export const watermarkKey = (version: string) => `watermarks/${version}.png`

/** Deleted per sweep at most (each is a call to R2). */
const PRUNE_DELETES = 200
/** A full pass over the cache starts at most this often. */
const PRUNE_EVERY_MS = 6 * 60 * 60_000

/**
 * Old watermark images, and gallery images made with an old watermark or from a replaced preview.
 * Run by the sweep: one page of the cache per run (two D1 queries), carrying on where the last run
 * stopped, and starting a new pass every few hours. Returns how many objects were deleted.
 */
export async function pruneGalleryCache(env: DamBindings): Promise<number> {
  const db = env.DB
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'gallery.prune'").first<{ value: string }>()
  let state: { prefix: string; cursor: string | null; nextAt: number }
  try {
    state = row ? JSON.parse(row.value) : { prefix: 'watermarks/', cursor: null, nextAt: 0 }
  } catch {
    state = { prefix: 'watermarks/', cursor: null, nextAt: 0 }
  }
  if (state.cursor === null && state.prefix === 'watermarks/' && Date.now() < state.nextAt) return 0

  const store = renditionStore(env)
  const page = await store.list(state.prefix, state.cursor ?? undefined)
  const current = (await getWatermark(db)).version
  let stale: string[]
  if (state.prefix === 'watermarks/') {
    stale = page.objects.map((o) => o.key).filter((key) => key !== (current ? watermarkKey(current) : ''))
  } else {
    // gallery/<watermark version or "plain">/<asset id>/<what>-<source rendition stamp>.<ext>
    const parsed = page.objects.map((o) => {
      const [, version, assetId, file] = o.key.split('/')
      return { key: o.key, version, assetId, what: file?.slice(0, file.lastIndexOf('-')), stamp: file?.slice(file.lastIndexOf('-') + 1, file.lastIndexOf('.')) }
    })
    const ids = [...new Set(parsed.map((p) => p.assetId).filter(Boolean))]
    const { results } = await db
      .prepare("SELECT asset_id, name, created_at FROM renditions WHERE name IN ('thumb', 'preview') AND asset_id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(ids))
      .all<{ asset_id: string; name: string; created_at: string }>()
    const stamps = new Map(results.map((r) => [`${r.asset_id}/${r.name}`, renditionStamp(r.created_at)]))
    stale = parsed
      .filter((p) => !p.assetId || (p.version !== 'plain' && p.version !== current) || stamps.get(`${p.assetId}/${sourceOf(p.what)}`) !== p.stamp)
      .map((p) => p.key)
  }
  const deleting = stale.slice(0, PRUNE_DELETES)
  for (const key of deleting) await store.delete(key)

  // Deletions shift the listing, so a page with more stale objects than one run deletes is listed again.
  const next =
    stale.length > deleting.length ? { ...state }
    : page.cursor ? { ...state, cursor: page.cursor }
    : state.prefix === 'watermarks/' ? { prefix: 'gallery/', cursor: null, nextAt: state.nextAt }
    : { prefix: 'watermarks/', cursor: null, nextAt: Date.now() + PRUNE_EVERY_MS }
  await db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('gallery.prune', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(JSON.stringify(next), nowIso())
    .run()
  return deleting.length
}

const renditionStamp = (createdAt: string) => createdAt.replace(/\D/g, '')

export type GalleryImage = RenditionName | 'small' | 'large'

/** The rendition a gallery image is made from: a thumbnail from the thumbnail, the rest from the preview. */
const sourceOf = (what: string | undefined): RenditionName => (what === 'thumb' || what === 'sheet' ? what : 'preview')

/**
 * An image of the photo for a gallery: its thumbnail or preview (watermarked when asked), or a JPEG
 * download made from the preview. Returns null when the photo has no preview to make it from.
 */
export async function galleryImage(
  env: DamBindings,
  assetId: string,
  what: GalleryImage,
  options: { watermark: boolean; longEdge?: number },
): Promise<{ body: ReadableStream; size: number; contentType: string } | null> {
  const store = renditionStore(env)
  const jpeg = what === 'small' || what === 'large'
  const watermark = options.watermark ? await getWatermark(env.DB) : null
  const version = watermark?.version ?? null
  // Unwatermarked views are the renditions themselves.
  if (!jpeg && !version) {
    const object = await store.get(renditionKey(assetId, what))
    return object && { body: object.body, size: object.size, contentType: 'image/webp' }
  }
  // Everything else starts from the preview (the thumbnail for a watermarked thumbnail).
  const sourceName = sourceOf(what)
  const source = await env.DB.prepare('SELECT width, height, created_at FROM renditions WHERE asset_id = ? AND name = ?')
    .bind(assetId, sourceName)
    .first<{ width: number | null; height: number | null; created_at: string }>()
  if (!source) return null
  const ext = jpeg ? 'jpg' : 'webp'
  const contentType = jpeg ? 'image/jpeg' : 'image/webp'
  // Named after the rendition it was made from, so a re-made preview is never served stale.
  const key = `gallery/${version ?? 'plain'}/${assetId}/${what}-${renditionStamp(source.created_at)}.${ext}`
  const cached = await store.get(key)
  if (cached) return jpeg ? credited(env.DB, assetId, await new Response(cached.body).arrayBuffer()) : { body: cached.body, size: cached.size, contentType }

  const images = countedImages(env)
  const original = await store.get(renditionKey(assetId, sourceName))
  if (!images || !original) return null
  let image = images.input(original.body)
  let width = source.width ?? 0
  if (jpeg) {
    const longEdge = options.longEdge ?? 2048
    image = image.transform({ width: longEdge, height: longEdge, fit: 'scale-down' })
    if (source.width && source.height) width = Math.round(source.width * Math.min(1, longEdge / Math.max(source.width, source.height)))
  }
  if (watermark && version) {
    const overlay = await watermarkOverlay(env, images, watermark, version, width || 1024)
    if (overlay) image = image.draw(overlay.stream(), drawOptions(watermark, width || 1024))
  }
  const output = await image.output(jpeg ? { format: 'image/jpeg', quality: 88 } : { format: 'image/webp', quality: 82 })
  const bytes = await output.response().arrayBuffer()
  await store.put(key, bytes, { contentType })
  if (jpeg) return credited(env.DB, assetId, bytes)
  return { body: new Blob([bytes]).stream(), size: bytes.byteLength, contentType }
}

/**
 * A JPEG download with the photographer's credit from the catalogue written in (Images outputs none). Added as it's
 * sent, not kept in the cache, so a changed copyright notice applies at once.
 */
async function credited(db: D1Database, assetId: string, bytes: ArrayBuffer) {
  const credit = await db.prepare('SELECT creator, copyright FROM assets WHERE id = ?').bind(assetId).first<Credit>()
  const out = creditJpeg(new Uint8Array(bytes), credit ?? { creator: null, copyright: null })
  return { body: new Blob([out.slice()]).stream(), size: out.length, contentType: 'image/jpeg' }
}

/** The watermark sized for a photo `width` pixels wide. Passed to draw() as plain bytes. */
async function watermarkOverlay(env: DamBindings, images: ImagesBinding, settings: WatermarkSettings, version: string, width: number): Promise<Blob | null> {
  const object = await renditionStore(env).get(watermarkKey(version))
  if (!object) return null
  const target = Math.max(16, Math.round(width * (settings.position === 'tiled' ? Math.min(settings.scale, 0.5) : settings.scale)))
  const resized = await images.input(object.body).transform({ width: target, fit: 'scale-down' }).output({ format: 'image/png' })
  return new Blob([await resized.response().arrayBuffer()])
}

function drawOptions(settings: WatermarkSettings, width: number): ImageDrawOptions {
  const margin = Math.round(width * 0.03)
  switch (settings.position) {
    case 'tiled':
      return { opacity: settings.opacity, repeat: true }
    case 'bottom-right':
      return { opacity: settings.opacity, bottom: margin, right: margin }
    case 'bottom-left':
      return { opacity: settings.opacity, bottom: margin, left: margin }
    default:
      return { opacity: settings.opacity }
  }
}
