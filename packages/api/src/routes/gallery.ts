/**
 * Client galleries, the client's side: everything under /api/public/galleries/<token>. No account; the
 * link's token is the key, plus the gallery's password where one is set (see catalog/shares.ts).
 * Nothing here reveals more than the gallery shows: unknown and revoked links look alike, and photos
 * outside the album are "not found" whatever their id.
 */
import { Hono, type Context } from 'hono'
import { consumeRateLimit } from '../auth/rate-limit'
import { verifyPassword } from '../auth/password'
import { getAsset, getLocations, type LocationRow } from '../catalog/assets'
import {
  addVisitor,
  cookieHeader,
  downloadSizes,
  galleryItems,
  inGallery,
  isDownloadSize,
  JPEG_LONG_EDGE,
  openGallery,
  recordEvent,
  setPick,
  submitPicks,
  unlockCookieName,
  unlockCookieValue,
  visitorCookieName,
  visitorPicks,
  type GalleryAccess,
  type ShareRow,
  type VisitorRow,
} from '../catalog/shares'
import { galleryImage, getWatermark } from '../catalog/watermark'
import type { DamEnv } from '../env'
import { BadRequest, optionalString, readJsonObject, requiredString } from '../lib/http'
import { applyGalleryLanguage, say } from '../lib/language'
import { attachmentDisposition, StorageError } from '../storage/types'
import { originalResponse } from '../storage/original'

export const galleryRoutes = new Hono<DamEnv>()

// Gallery links must not end up in search engines or in other sites' referrer logs.
galleryRoutes.use('*', async (c, next) => {
  await next()
  c.res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  c.res.headers.set('Referrer-Policy', 'no-referrer')
})

const UNLOCK_RULE = { max: 10, windowMs: 60_000 }
const VISITOR_RULE = { max: 10, windowMs: 60_000, keyPrefix: 'gallery-visitor' }

type Open = Extract<GalleryAccess, { state: 'open' }>

/** The gallery if this request may see it, or the response saying why not. */
async function access(c: Context<DamEnv>): Promise<Open | Response> {
  const gallery = await openGallery(c.env, c.req.param('token') ?? '', c.req.raw)
  if (gallery.state !== 'gone') applyGalleryLanguage(c.req.raw, gallery.share.language, c.env)
  switch (gallery.state) {
    case 'gone':
      return c.json({ error: 'gone', message: say('gallery.api.gone') }, 404)
    case 'expired':
      return c.json({ error: 'expired', message: say('gallery.api.expired'), expiredAt: gallery.share.expires_at }, 410)
    case 'locked':
      return c.json({ error: 'locked', message: say('gallery.api.locked'), title: gallery.share.title }, 401)
    default:
      return gallery
  }
}

/** What the gallery page shows: the gallery's settings, its photos, and this visitor's picks. */
export async function galleryJson(db: D1Database, share: ShareRow, visitor: VisitorRow | null, member: { name: string } | null = null) {
  const [items, picks, watermark] = await Promise.all([
    galleryItems(db, share),
    visitor ? visitorPicks(db, visitor.id) : Promise.resolve([]),
    share.watermark === 1 ? getWatermark(db) : Promise.resolve(null),
  ])
  return {
    gallery: {
      title: share.title,
      message: share.message,
      expiresAt: share.expires_at,
      downloadSizes: downloadSizes(share),
      proofing: share.proofing === 1,
      showFilenames: share.show_filenames === 1,
      watermark: share.watermark === 1,
      /**
       * Part of every image address, so browsers fetch again when the watermark changes or is turned
       * on or off (images are cached for an hour).
       */
      imageVersion: watermark?.version ?? 'plain',
    },
    items,
    visitor: visitor ? { name: visitor.name, submittedAt: visitor.submitted_at } : null,
    /** A client signed in to their account: picks are theirs, and there's a way back to their galleries. */
    member: member ? { name: member.name } : null,
    picks,
  }
}

galleryRoutes.get('/:token', async (c) => {
  const gallery = await access(c)
  if (gallery instanceof Response) return gallery
  await recordEvent(c.env.DB, gallery.share, { kind: 'open', visitorId: gallery.visitor?.id })
  return c.json(await galleryJson(c.env.DB, gallery.share, gallery.visitor, gallery.member))
})

galleryRoutes.post('/:token/unlock', async (c) => {
  const gallery = await openGallery(c.env, c.req.param('token'), c.req.raw)
  if (gallery.state !== 'gone') applyGalleryLanguage(c.req.raw, gallery.share.language, c.env)
  if (gallery.state === 'gone') return c.json({ error: 'gone', message: say('gallery.api.gone') }, 404)
  if (gallery.state === 'expired') return c.json({ error: 'expired', message: say('gallery.api.expired') }, 410)
  const share = gallery.share
  if (!share.password_hash) return c.json({ ok: true })
  const limited = await consumeRateLimit(c, { ...UNLOCK_RULE, keyPrefix: `gallery-unlock:${share.id}` })
  if (limited) return limited
  try {
    const password = requiredString(await readJsonObject(c), 'password', 200)
    if (!(await verifyPassword(password, share.password_hash)) || !c.env.BETTER_AUTH_SECRET) {
      return c.json({ error: 'wrong_password', message: say('gallery.error.password') }, 401)
    }
    const cookie = await unlockCookieValue(c.env.BETTER_AUTH_SECRET, share)
    c.header('Set-Cookie', cookieHeader(c.req.raw, unlockCookieName(share.id), cookie.value, cookie.maxAge))
    return c.json({ ok: true })
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

/** Say who you are, to pick favourites. */
galleryRoutes.post('/:token/visitor', async (c) => {
  const gallery = await access(c)
  if (gallery instanceof Response) return gallery
  if (gallery.share.proofing !== 1) return c.json({ error: 'forbidden', message: say('gallery.api.noFavourites') }, 403)
  const limited = await consumeRateLimit(c, VISITOR_RULE)
  if (limited) return limited
  try {
    const body = await readJsonObject(c)
    const name = requiredString(body, 'name', 100)
    const email = optionalString(body, 'email', 254) || null
    const visitor = await addVisitor(c.env.DB, gallery.share, name, email)
    c.header('Set-Cookie', cookieHeader(c.req.raw, visitorCookieName(gallery.share.id), visitor.id, 365 * 24 * 60 * 60))
    return c.json({ visitor: { name: visitor.name, submittedAt: null } }, 201)
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

async function pick(c: Context<DamEnv>, picked: boolean) {
  const gallery = await access(c)
  if (gallery instanceof Response) return gallery
  if (gallery.share.proofing !== 1) return c.json({ error: 'forbidden', message: say('gallery.api.noFavourites') }, 403)
  if (!gallery.visitor) return c.json({ error: 'no_visitor', message: say('gallery.api.nameFirst') }, 409)
  const assetId = c.req.param('assetId') ?? ''
  if (!(await inGallery(c.env.DB, gallery.share, assetId))) return c.json({ error: 'not_found' }, 404)
  await setPick(c.env.DB, gallery.share, gallery.visitor.id, assetId, picked)
  return c.body(null, 204)
}

galleryRoutes.put('/:token/picks/:assetId', (c) => pick(c, true))
galleryRoutes.delete('/:token/picks/:assetId', (c) => pick(c, false))

/** "I'm done": the photographer sees this person's selection as finished. */
galleryRoutes.post('/:token/submit', async (c) => {
  const gallery = await access(c)
  if (gallery instanceof Response) return gallery
  if (!gallery.visitor) return c.json({ error: 'no_visitor', message: say('gallery.api.nameFirst') }, 409)
  await submitPicks(c.env.DB, gallery.visitor.id)
  return c.json({ ok: true })
})

/** Thumbnails and large views, watermarked when the link says so. */
galleryRoutes.get('/:token/assets/:assetId/:name{thumb|preview}', async (c) => {
  const gallery = await access(c)
  if (gallery instanceof Response) return gallery
  const { assetId, name } = c.req.param()
  if (!(await inGallery(c.env.DB, gallery.share, assetId))) return c.json({ error: 'not_found' }, 404)
  const image = await galleryImage(c.env, assetId, name as 'thumb' | 'preview', { watermark: gallery.share.watermark === 1 })
  if (!image) return c.json({ error: 'not_found' }, 404)
  return new Response(image.body, {
    headers: { 'Content-Type': image.contentType, 'Content-Length': String(image.size), 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline' },
  })
})

/** Where the original can be read from for a client: never a NAS, never deep storage that isn't restored. */
function reachable(locations: LocationRow[], nas: Set<string>): LocationRow | null {
  const usable = locations.filter(
    (l) => !nas.has(l.connection_id) && l.state !== 'pending' && l.state !== 'gone' && (!['GLACIER', 'DEEP_ARCHIVE'].includes(l.storage_class) || l.state === 'restored'),
  )
  return usable.find((l) => l.connection_id === 'r2') ?? usable[0] ?? null
}

galleryRoutes.get('/:token/assets/:assetId/download/:size', async (c) => {
  const gallery = await access(c)
  if (gallery instanceof Response) return gallery
  const { assetId, size } = c.req.param()
  const share = gallery.share
  if (!isDownloadSize(size) || !downloadSizes(share).includes(size)) return c.json({ error: 'forbidden', message: say('gallery.api.sizeNotOffered') }, 403)
  if (!(await inGallery(c.env.DB, share, assetId))) return c.json({ error: 'not_found' }, 404)
  const asset = await getAsset(c.env.DB, assetId)
  if (!asset) return c.json({ error: 'not_found' }, 404)
  const base = asset.filename.replace(/\.[^.]*$/, '') || 'photo'

  if (size === 'original') {
    const { results: nas } = await c.env.DB.prepare("SELECT id FROM storage_connections WHERE provider = 'nas'").all<{ id: string }>()
    const location = reachable(await getLocations(c.env.DB, assetId), new Set(nas.map((n) => n.id)))
    if (!location) return c.json({ error: 'unavailable', message: say('gallery.api.originalUnavailable') }, 409)
    try {
      const response = await originalResponse(c.env, c.req.raw, asset, location)
      if (!response) return c.json({ error: 'unavailable', message: say('gallery.api.originalUnavailable') }, 409)
      if (!c.req.header('Range')) await recordEvent(c.env.DB, share, { kind: 'download', visitorId: gallery.visitor?.id, assetId, size })
      return response
    } catch (error) {
      if (error instanceof StorageError) return c.json({ error: 'unavailable', message: say('gallery.api.originalLater') }, 502)
      throw error
    }
  }

  if (asset.mime_type.startsWith('video/')) return c.json({ error: 'forbidden', message: say('gallery.api.videoOriginalOnly') }, 403)
  const image = await galleryImage(c.env, assetId, size, { watermark: share.watermark === 1, longEdge: JPEG_LONG_EDGE[size] })
  if (!image) return c.json({ error: 'unavailable', message: say('gallery.api.noPreview') }, 409)
  await recordEvent(c.env.DB, share, { kind: 'download', visitorId: gallery.visitor?.id, assetId, size })
  return new Response(image.body, {
    headers: {
      'Content-Type': image.contentType,
      'Content-Length': String(image.size),
      'Content-Disposition': attachmentDisposition(`${base}-${size}.jpg`),
      'Cache-Control': 'private, no-store',
    },
  })
})
