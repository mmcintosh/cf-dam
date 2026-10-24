/**
 * Client galleries (plans/PLAN-P4-v1.md): links that show one album to people without an account.
 *
 * The link's token is the secret. A password, when set, is checked once and remembered in a signed
 * cookie for that gallery; changing the password invalidates every such cookie. Visitors who pick
 * favourites give a name and get a visitor id (random, so it needs no signature). What a client sees
 * is limited to the album's photos, their sizes, title, caption and (if allowed) filename.
 */
import { asLanguage, type Language } from '@cf-dam/i18n'
import { editedSize, imageVersion, readEdit } from './edits'
import { galleryMember, memberVisitor } from './clients'
import type { DamBindings } from '../env'
import { hashPassword } from '../auth/password'
import { randomBase62, randomId, timingSafeEqual, toHex } from '../lib/crypto'
import { BadRequest, optionalString, requiredString } from '../lib/http'
import { nowIso } from '../lib/time'
import { say } from '../lib/language'

export const DOWNLOAD_SIZES = ['small', 'large', 'original'] as const
export type DownloadSize = (typeof DOWNLOAD_SIZES)[number]
/** Long edge of the JPEG made for each size (originals are sent as they are). */
export const JPEG_LONG_EDGE: Record<Exclude<DownloadSize, 'original'>, number> = { small: 1024, large: 2048 }

export const isDownloadSize = (value: unknown): value is DownloadSize => typeof value === 'string' && (DOWNLOAD_SIZES as readonly string[]).includes(value)

/** A gallery shows at most this many photos (an album bigger than this is cut off, newest additions last). */
export const MAX_GALLERY_ITEMS = 2000
/** How long an unlocked gallery stays unlocked in one browser. */
const UNLOCK_SECONDS = 30 * 24 * 60 * 60

export interface ShareRow {
  id: string
  token: string
  album_id: string
  name: string
  title: string
  message: string
  password_hash: string | null
  expires_at: string | null
  download_sizes: string
  watermark: number
  proofing: number
  show_filenames: number
  final_delivery: number
  /** The gallery's fixed language, or null for each visitor's own. */
  language: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  revoked_at: string | null
}

export type ShareStatus = 'active' | 'expired' | 'revoked'

export function shareStatus(row: Pick<ShareRow, 'revoked_at' | 'expires_at'>, now = nowIso()): ShareStatus {
  if (row.revoked_at) return 'revoked'
  if (row.expires_at && row.expires_at <= now) return 'expired'
  return 'active'
}

export function downloadSizes(row: Pick<ShareRow, 'download_sizes'>): DownloadSize[] {
  try {
    const parsed: unknown = JSON.parse(row.download_sizes)
    return Array.isArray(parsed) ? DOWNLOAD_SIZES.filter((s) => parsed.includes(s)) : []
  } catch {
    return []
  }
}

export interface ShareStats {
  opens: number
  visitors: number
  picks: number
  downloads: number
  lastOpenedAt: string | null
}

export interface ShareJson {
  id: string
  token: string
  albumId: string
  albumName: string | null
  name: string
  title: string
  message: string
  hasPassword: boolean
  expiresAt: string | null
  downloadSizes: DownloadSize[]
  watermark: boolean
  proofing: boolean
  showFilenames: boolean
  /** Made as the job's final delivery (catalog/jobs.ts markDelivered). */
  finalDelivery: boolean
  language: Language | null
  status: ShareStatus
  createdAt: string
  updatedAt: string
  revokedAt: string | null
  stats: ShareStats
}

type ListedShareRow = ShareRow & {
  album_name: string | null
  opens: number
  visitors: number
  picks: number
  downloads: number
  last_opened_at: string | null
}

const SHARE_SELECT = `SELECT s.*, al.name AS album_name,
  (SELECT COUNT(*) FROM share_events e WHERE e.share_id = s.id AND e.kind = 'open') AS opens,
  (SELECT MAX(e.created_at) FROM share_events e WHERE e.share_id = s.id AND e.kind = 'open') AS last_opened_at,
  (SELECT COUNT(*) FROM share_events e WHERE e.share_id = s.id AND e.kind = 'download') AS downloads,
  (SELECT COUNT(*) FROM share_visitors v WHERE v.share_id = s.id) AS visitors,
  (SELECT COUNT(*) FROM share_picks p WHERE p.share_id = s.id) AS picks
  FROM shares s LEFT JOIN albums al ON al.id = s.album_id`

function shareJson(row: ListedShareRow): ShareJson {
  return {
    id: row.id,
    token: row.token,
    albumId: row.album_id,
    albumName: row.album_name,
    name: row.name,
    title: row.title,
    message: row.message,
    hasPassword: row.password_hash !== null,
    expiresAt: row.expires_at,
    downloadSizes: downloadSizes(row),
    watermark: row.watermark === 1,
    proofing: row.proofing === 1,
    showFilenames: row.show_filenames === 1,
    finalDelivery: row.final_delivery === 1,
    language: (asLanguage(row.language) as Language | null) ?? null,
    status: shareStatus(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
    stats: { opens: row.opens, visitors: row.visitors, picks: row.picks, downloads: row.downloads, lastOpenedAt: row.last_opened_at },
  }
}

export async function listShares(db: D1Database, albumId?: string): Promise<ShareJson[]> {
  const { results } = await (albumId
    ? db.prepare(`${SHARE_SELECT} WHERE s.album_id = ? ORDER BY s.created_at DESC`).bind(albumId)
    : db.prepare(`${SHARE_SELECT} ORDER BY s.revoked_at IS NOT NULL, s.created_at DESC`)
  ).all<ListedShareRow>()
  return results.map(shareJson)
}

/** The galleries of a job's albums (catalog/jobs.ts), newest first. */
export async function jobShares(db: D1Database, jobId: string): Promise<ShareJson[]> {
  const { results } = await db
    .prepare(`${SHARE_SELECT} WHERE s.album_id IN (SELECT id FROM albums WHERE job_id = ?) ORDER BY s.revoked_at IS NOT NULL, s.created_at DESC`)
    .bind(jobId)
    .all<ListedShareRow>()
  return results.map(shareJson)
}

/** The links any of a client's people were invited to, and their jobs' galleries (catalog/client-records.ts), newest first. */
export async function clientShares(db: D1Database, clientId: string): Promise<ShareJson[]> {
  const { results } = await db
    .prepare(
      `${SHARE_SELECT} WHERE s.id IN (SELECT m.share_id FROM share_members m JOIN client_people p ON p.user_id = m.user_id WHERE p.client_id = ?1)
          OR s.album_id IN (SELECT al.id FROM albums al JOIN jobs j ON j.id = al.job_id WHERE j.client_id = ?1)
       ORDER BY s.revoked_at IS NOT NULL, s.created_at DESC`,
    )
    .bind(clientId)
    .all<ListedShareRow>()
  return results.map(shareJson)
}

export async function getShare(db: D1Database, id: string): Promise<ShareJson | null> {
  const row = await db.prepare(`${SHARE_SELECT} WHERE s.id = ?`).bind(id).first<ListedShareRow>()
  return row ? shareJson(row) : null
}

export interface ShareInput {
  name?: string
  title?: string
  message?: string
  /** A new password; null removes it; undefined leaves it. */
  password?: string | null
  /** null: never expires. */
  expiresAt?: string | null
  downloadSizes?: DownloadSize[]
  watermark?: boolean
  proofing?: boolean
  showFilenames?: boolean
  finalDelivery?: boolean
  /** null: each visitor's own language. */
  language?: Language | null
}

function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new BadRequest(`${field} must be true or false.`)
  return value
}

/** Read and check the fields of a create or edit request. */
export function parseShareInput(body: Record<string, unknown>, creating: boolean): ShareInput {
  const input: ShareInput = {
    name: creating ? requiredString(body, 'name', 200) : optionalString(body, 'name', 200),
    title: optionalString(body, 'title', 200),
    message: optionalString(body, 'message', 2000),
    watermark: optionalBoolean(body, 'watermark'),
    proofing: optionalBoolean(body, 'proofing'),
    showFilenames: optionalBoolean(body, 'showFilenames'),
    finalDelivery: optionalBoolean(body, 'finalDelivery'),
  }
  if (input.name === '') throw new BadRequest('name is required.')
  if (body.language === null) input.language = null
  else if (body.language !== undefined) {
    const language = asLanguage(body.language) as Language | null
    if (!language) throw new BadRequest('language must be one of the languages cf-dam speaks, or null.')
    input.language = language
  }
  if (body.password === null) input.password = null
  else if (body.password !== undefined) {
    if (typeof body.password !== 'string' || body.password.length < 4 || body.password.length > 200) {
      throw new BadRequest(say('err.galleryPassword'))
    }
    input.password = body.password
  }
  if (body.expiresAt === null) input.expiresAt = null
  else if (body.expiresAt !== undefined) {
    const at = typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : null
    if (!at || Number.isNaN(at.getTime())) throw new BadRequest('expiresAt must be a date and time.')
    input.expiresAt = at.toISOString()
  }
  if (body.downloadSizes !== undefined) {
    const sizes = body.downloadSizes
    if (!Array.isArray(sizes) || !sizes.every(isDownloadSize)) throw new BadRequest(`downloadSizes may hold ${DOWNLOAD_SIZES.join(', ')}.`)
    input.downloadSizes = DOWNLOAD_SIZES.filter((s) => sizes.includes(s))
  }
  return input
}

export async function createShare(db: D1Database, albumId: string, input: ShareInput, userId: string): Promise<ShareJson | null> {
  const album = await db.prepare('SELECT name FROM albums WHERE id = ?').bind(albumId).first<{ name: string }>()
  if (!album) return null
  const id = randomId()
  const now = nowIso()
  await db
    .prepare(
      `INSERT INTO shares (id, token, album_id, name, title, message, password_hash, expires_at, download_sizes, watermark, proofing, show_filenames, language, final_delivery, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      randomBase62(22),
      albumId,
      input.name!,
      input.title || album.name,
      input.message ?? '',
      input.password ? await hashPassword(input.password) : null,
      input.expiresAt ?? null,
      JSON.stringify(input.downloadSizes ?? []),
      input.watermark ? 1 : 0,
      input.proofing === false ? 0 : 1,
      input.showFilenames === false ? 0 : 1,
      input.language ?? null,
      input.finalDelivery ? 1 : 0,
      userId,
      now,
      now,
    )
    .run()
  return getShare(db, id)
}

/** Edit a link. A revoked link can't be edited (make a new one). Returns false when there is no such live link. */
export async function updateShare(db: D1Database, id: string, input: ShareInput): Promise<boolean> {
  const sets: string[] = []
  const params: unknown[] = []
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`)
    params.push(value)
  }
  if (input.name !== undefined) set('name', input.name)
  if (input.title !== undefined && input.title !== '') set('title', input.title)
  if (input.message !== undefined) set('message', input.message)
  if (input.password !== undefined) set('password_hash', input.password === null ? null : await hashPassword(input.password))
  if (input.expiresAt !== undefined) set('expires_at', input.expiresAt)
  if (input.downloadSizes !== undefined) set('download_sizes', JSON.stringify(input.downloadSizes))
  if (input.watermark !== undefined) set('watermark', input.watermark ? 1 : 0)
  if (input.proofing !== undefined) set('proofing', input.proofing ? 1 : 0)
  if (input.showFilenames !== undefined) set('show_filenames', input.showFilenames ? 1 : 0)
  if (input.finalDelivery !== undefined) set('final_delivery', input.finalDelivery ? 1 : 0)
  if (input.language !== undefined) set('language', input.language)
  set('updated_at', nowIso())
  const result = await db
    .prepare(`UPDATE shares SET ${sets.join(', ')} WHERE id = ? AND revoked_at IS NULL`)
    .bind(...params, id)
    .run()
  return result.meta.changes === 1
}

export async function revokeShare(db: D1Database, id: string): Promise<boolean> {
  const now = nowIso()
  const result = await db.prepare('UPDATE shares SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, now, id).run()
  return result.meta.changes === 1
}

// ---------------------------------------------------------------------------------------------------
// The client's side.

export const unlockCookieName = (shareId: string) => `cfdam_g_${shareId}`
export const visitorCookieName = (shareId: string) => `cfdam_v_${shareId}`

async function unlockKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('cf-dam'), info: new TextEncoder().encode('gallery-unlock v1') },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  )
}

/** The MAC covers the password hash, so a new password (or none) invalidates every unlock cookie. */
async function unlockMac(secret: string, share: Pick<ShareRow, 'id' | 'password_hash'>, expires: number): Promise<string> {
  const key = await unlockKey(secret)
  const data = new TextEncoder().encode(`${share.id}|${expires}|${share.password_hash ?? ''}`)
  return toHex(await crypto.subtle.sign('HMAC', key, data))
}

export async function unlockCookieValue(secret: string, share: Pick<ShareRow, 'id' | 'password_hash' | 'expires_at'>): Promise<{ value: string; maxAge: number }> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const shareEnds = share.expires_at ? Math.floor(new Date(share.expires_at).getTime() / 1000) : Number.POSITIVE_INFINITY
  const expires = Math.min(nowSeconds + UNLOCK_SECONDS, shareEnds)
  return { value: `${expires}.${await unlockMac(secret, share, expires)}`, maxAge: Math.max(0, expires - nowSeconds) }
}

async function unlockCookieValid(secret: string, share: Pick<ShareRow, 'id' | 'password_hash'>, value: string | undefined): Promise<boolean> {
  const [expiresText, mac] = (value ?? '').split('.')
  const expires = Number(expiresText)
  if (!mac || !Number.isInteger(expires) || expires * 1000 < Date.now()) return false
  return timingSafeEqual(mac, await unlockMac(secret, share, expires))
}

export function readCookies(request: Request): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0) map.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
  }
  return map
}

export function cookieHeader(request: Request, name: string, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`
}

export interface VisitorRow {
  id: string
  share_id: string
  /** Set for a client signed in to their account. */
  user_id?: string | null
  name: string
  email: string | null
  created_at: string
  last_seen_at: string
  submitted_at: string | null
}

export type GalleryAccess =
  | { state: 'gone' }
  | { state: 'expired'; share: ShareRow }
  | { state: 'locked'; share: ShareRow }
  | { state: 'open'; share: ShareRow; visitor: VisitorRow | null; member: { userId: string; name: string } | null }

/** What this request may see of the gallery behind `token`. */
export async function openGallery(env: DamBindings, token: string, request: Request): Promise<GalleryAccess> {
  if (!/^[0-9A-Za-z]{22}$/.test(token)) return { state: 'gone' }
  const share = await env.DB.prepare('SELECT * FROM shares WHERE token = ?').bind(token).first<ShareRow>()
  if (!share) return { state: 'gone' }
  const status = shareStatus(share)
  if (status === 'revoked') return { state: 'gone' }
  if (status === 'expired') return { state: 'expired', share }
  // A client signed in to their account (catalog/clients.ts): no password, and favourites of their own.
  const member = await galleryMember(env, share, request)
  if (member) return { state: 'open', share, visitor: await memberVisitor(env.DB, share, member), member: { userId: member.userId, name: member.name } }
  const cookies = readCookies(request)
  if (share.password_hash) {
    if (!env.BETTER_AUTH_SECRET || !(await unlockCookieValid(env.BETTER_AUTH_SECRET, share, cookies.get(unlockCookieName(share.id))))) {
      return { state: 'locked', share }
    }
  }
  const visitorId = cookies.get(visitorCookieName(share.id))
  const visitor = visitorId && /^[0-9a-f]{32}$/.test(visitorId)
    ? await env.DB.prepare('SELECT * FROM share_visitors WHERE id = ? AND share_id = ? AND user_id IS NULL').bind(visitorId, share.id).first<VisitorRow>()
    : null
  return { state: 'open', share, visitor, member: null }
}

export interface GalleryItem {
  id: string
  width: number | null
  height: number | null
  filename: string | null
  title: string | null
  caption: string | null
  alt: string | null
  video: boolean
  hasThumb: boolean
  hasPreview: boolean
  /** Changes with each edit: part of the image addresses. */
  imageVersion: string
  /** Whether the original can be downloaded from here (not on a NAS, not in deep storage). */
  originalReachable: boolean
}

/** The album's photos as the client sees them, in album order. */
export async function galleryItems(db: D1Database, share: Pick<ShareRow, 'album_id' | 'show_filenames'>): Promise<GalleryItem[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.width, a.height, a.filename, a.title, a.caption, a.alt, a.mime_type, a.edit, a.edited_at,
         EXISTS (SELECT 1 FROM renditions r WHERE r.asset_id = a.id AND r.name = 'thumb') AS has_thumb,
         EXISTS (SELECT 1 FROM renditions r WHERE r.asset_id = a.id AND r.name = 'preview') AS has_preview,
         EXISTS (SELECT 1 FROM asset_locations l JOIN storage_connections c ON c.id = l.connection_id
                 WHERE l.asset_id = a.id AND c.provider <> 'nas' AND l.state NOT IN ('pending', 'gone')
                   AND (l.storage_class NOT IN ('GLACIER', 'DEEP_ARCHIVE') OR l.state = 'restored')) AS reachable
       FROM album_items ai JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL
       WHERE ai.album_id = ? ORDER BY ai.position, ai.added_at LIMIT ?`,
    )
    .bind(share.album_id, MAX_GALLERY_ITEMS)
    .all<{ id: string; width: number | null; height: number | null; filename: string; title: string | null; caption: string | null; alt: string | null; mime_type: string; edit: string | null; edited_at: string | null; has_thumb: number; has_preview: number; reachable: number }>()
  return results.map((r) => {
    // The size of the picture shown: an edit may turn or crop it.
    const shown = r.width && r.height ? editedSize(r.width, r.height, readEdit(r.edit)) : null
    return {
      id: r.id,
      width: shown?.width ?? r.width,
      height: shown?.height ?? r.height,
      imageVersion: imageVersion(r.edited_at),
      filename: share.show_filenames ? r.filename : null,
      title: r.title,
      caption: r.caption,
      alt: r.alt,
      video: r.mime_type.startsWith('video/'),
      hasThumb: r.has_thumb === 1,
      hasPreview: r.has_preview === 1,
      originalReachable: r.reachable === 1,
    }
  })
}

/** Whether an asset is shown by this gallery (in its album and not deleted). */
export async function inGallery(db: D1Database, share: Pick<ShareRow, 'album_id'>, assetId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS present FROM album_items ai JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL WHERE ai.album_id = ? AND ai.asset_id = ?')
    .bind(share.album_id, assetId)
    .first()
  return row !== null
}

export async function recordEvent(
  db: D1Database,
  share: Pick<ShareRow, 'id'>,
  event: { kind: 'open' | 'download'; visitorId?: string | null; assetId?: string; size?: DownloadSize },
): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO share_events (share_id, visitor_id, kind, asset_id, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(share.id, event.visitorId ?? null, event.kind, event.assetId ?? null, event.size ?? null, nowIso())
      .run()
  } catch (error) {
    // Stats never stand in the way of the client.
    console.warn('[shares] event not recorded', error)
  }
}

export async function addVisitor(db: D1Database, share: Pick<ShareRow, 'id'>, name: string, email: string | null): Promise<VisitorRow> {
  const now = nowIso()
  const visitor: VisitorRow = { id: randomId(), share_id: share.id, name, email, created_at: now, last_seen_at: now, submitted_at: null }
  await db
    .prepare('INSERT INTO share_visitors (id, share_id, name, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(visitor.id, share.id, name, email, now, now)
    .run()
  return visitor
}

export async function visitorPicks(db: D1Database, visitorId: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT asset_id FROM share_picks WHERE visitor_id = ? ORDER BY created_at').bind(visitorId).all<{ asset_id: string }>()
  return results.map((r) => r.asset_id)
}

/** Pick or unpick a photo. A change after "I'm done" reopens the selection. */
export async function setPick(db: D1Database, share: Pick<ShareRow, 'id'>, visitorId: string, assetId: string, picked: boolean): Promise<void> {
  const now = nowIso()
  await db.batch([
    picked
      ? db.prepare('INSERT OR IGNORE INTO share_picks (visitor_id, asset_id, share_id, created_at) VALUES (?, ?, ?, ?)').bind(visitorId, assetId, share.id, now)
      : db.prepare('DELETE FROM share_picks WHERE visitor_id = ? AND asset_id = ?').bind(visitorId, assetId),
    db.prepare('UPDATE share_visitors SET last_seen_at = ?, submitted_at = NULL WHERE id = ?').bind(now, visitorId),
  ])
}

export async function submitPicks(db: D1Database, visitorId: string): Promise<void> {
  const now = nowIso()
  await db.prepare('UPDATE share_visitors SET submitted_at = ?, last_seen_at = ? WHERE id = ?').bind(now, now, visitorId).run()
}

// ---------------------------------------------------------------------------------------------------
// The photographer's view of who picked what.

export interface VisitorJson {
  id: string
  name: string
  email: string | null
  createdAt: string
  lastSeenAt: string
  submittedAt: string | null
  picks: number
  downloads: number
}

export async function shareVisitors(db: D1Database, shareId: string): Promise<VisitorJson[]> {
  const { results } = await db
    .prepare(
      `SELECT v.*, (SELECT COUNT(*) FROM share_picks p WHERE p.visitor_id = v.id) AS picks,
         (SELECT COUNT(*) FROM share_events e WHERE e.visitor_id = v.id AND e.kind = 'download') AS downloads
       FROM share_visitors v WHERE v.share_id = ? ORDER BY v.created_at`,
    )
    .bind(shareId)
    .all<VisitorRow & { picks: number; downloads: number }>()
  return results.map((v) => ({
    id: v.id,
    name: v.name,
    email: v.email,
    createdAt: v.created_at,
    lastSeenAt: v.last_seen_at,
    submittedAt: v.submitted_at,
    picks: v.picks,
    downloads: v.downloads,
  }))
}

/** Every pick on a link: asset id → the visitors who picked it. */
export async function sharePicks(db: D1Database, shareId: string): Promise<Record<string, string[]>> {
  const { results } = await db
    .prepare('SELECT asset_id, visitor_id FROM share_picks WHERE share_id = ? ORDER BY created_at')
    .bind(shareId)
    .all<{ asset_id: string; visitor_id: string }>()
  const picks: Record<string, string[]> = {}
  for (const r of results) (picks[r.asset_id] ??= []).push(r.visitor_id)
  return picks
}

/** Downloads per photo and size on a link. */
export async function shareDownloads(db: D1Database, shareId: string): Promise<{ assetId: string; size: string; count: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT asset_id, size, COUNT(*) AS count FROM share_events
       WHERE share_id = ? AND kind = 'download' AND asset_id IS NOT NULL GROUP BY asset_id, size ORDER BY count DESC`,
    )
    .bind(shareId)
    .all<{ asset_id: string; size: string; count: number }>()
  return results.map((r) => ({ assetId: r.asset_id, size: r.size, count: r.count }))
}

/**
 * The photos picked on a link by the chosen visitors (all of them when none are named): picked by any
 * of them, or by every one of them. In album order.
 */
export async function pickedAssets(db: D1Database, share: Pick<ShareRow, 'id' | 'album_id'>, visitorIds: string[] | null, mode: 'any' | 'all'): Promise<string[]> {
  const chosen = visitorIds ?? (await db.prepare('SELECT id FROM share_visitors WHERE share_id = ?').bind(share.id).all<{ id: string }>()).results.map((r) => r.id)
  if (chosen.length === 0) return []
  const { results } = await db
    .prepare(
      `SELECT p.asset_id FROM share_picks p
       JOIN album_items ai ON ai.album_id = ? AND ai.asset_id = p.asset_id
       JOIN assets a ON a.id = p.asset_id AND a.deleted_at IS NULL
       WHERE p.share_id = ? AND p.visitor_id IN (SELECT value FROM json_each(?))
       GROUP BY p.asset_id HAVING COUNT(DISTINCT p.visitor_id) >= ?
       ORDER BY MIN(ai.position), MIN(ai.added_at)`,
    )
    .bind(share.album_id, share.id, JSON.stringify(chosen), mode === 'all' ? chosen.length : 1)
    .all<{ asset_id: string }>()
  return results.map((r) => r.asset_id)
}
