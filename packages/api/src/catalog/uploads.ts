/**
 * The upload protocol. One flow for every size and destination:
 *
 *   1. create   → the server picks the destination, starts a multipart upload, records the asset
 *   2. parts    → the client PUTs each part: straight to storage on presigned URLs ('direct'), or
 *                 through the Worker when the provider can't presign ('proxied', the R2 binding)
 *   3. complete → the server completes the multipart upload, checks the size, and processes the asset
 *
 * Optionally, before completing, the client sends a thumbnail and preview it made itself. That is how
 * an original uploaded straight into Glacier still gets a picture: the Worker can't read it back.
 */
import type { Principal } from '../auth/principal'
import type { DamBindings } from '../env'
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { connectionKey, defaultConnection, getConnection, providerFor, type Connection } from '../storage/connections'
import { isStorageClass, StorageError, type CompletedPart, type PresignedRequest, type StorageClass } from '../storage/types'

const MiB = 1024 * 1024
export const MIN_PART_SIZE = 16 * MiB
export const MAX_PARTS = 10_000
/** S3's ceiling for one object. */
export const MAX_UPLOAD_SIZE = 5 * 1024 ** 4
/**
 * Parts proxied through the Worker must fit in one request body, which Workers cap at 100 MB on
 * most plans. That bounds a proxied upload to about 950 GB; bigger files need an S3 connection.
 */
export const MAX_PROXIED_PART_SIZE = 95 * 1024 * 1024
export const MAX_PROXIED_UPLOAD_SIZE = MAX_PARTS * MAX_PROXIED_PART_SIZE
const UPLOAD_TTL_DAYS = 7
const PART_URL_TTL_SECONDS = 3600

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
    readonly code = 'invalid_upload',
  ) {
    super(message)
  }
}

export interface UploadRow {
  id: string
  asset_id: string
  connection_id: string
  key: string
  multipart_id: string
  mode: 'direct' | 'proxied'
  storage_class: string
  part_size: number
  part_count: number
  size: number
  created_by: string
  created_at: string
  expires_at: string
}

/** A part size that keeps the upload within S3's 10,000-part limit, in whole MiB. */
export function partSizeFor(size: number): number {
  const needed = Math.ceil(size / MAX_PARTS)
  return Math.max(MIN_PART_SIZE, Math.ceil(needed / MiB) * MiB)
}

/** A filename safe to use in a storage key and to show: no path, no control characters. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').trim().slice(0, 200)
  return cleaned || 'untitled'
}

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
  cr2: 'image/x-canon-cr2', cr3: 'image/x-canon-cr3', nef: 'image/x-nikon-nef', arw: 'image/x-sony-arw',
  dng: 'image/x-adobe-dng', raf: 'image/x-fuji-raf', orf: 'image/x-olympus-orf', rw2: 'image/x-panasonic-rw2',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', pdf: 'application/pdf', xmp: 'application/rdf+xml',
}

/** The type to record: from the extension when known (browsers often send '' for RAW), else the claim. */
export function mimeTypeFor(filename: string, claimed: string | undefined): string {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  const known = EXTENSION_TYPES[ext]
  if (known) return known
  return claimed && /^[\w.+-]+\/[\w.+-]+$/.test(claimed) ? claimed.toLowerCase() : 'application/octet-stream'
}

export interface CreateUploadInput {
  filename: string
  size: number
  contentType?: string
  sha256?: string
  connectionId?: string
  storageClass?: string
  allowDuplicate?: boolean
}

export type CreateUploadResult =
  | { duplicateOf: string }
  | { uploadId: string; assetId: string; mode: 'direct' | 'proxied'; partSize: number; partCount: number; storageClass: StorageClass; connectionId: string }

export async function createUpload(env: DamBindings, principal: Principal, input: CreateUploadInput): Promise<CreateUploadResult> {
  if (!Number.isInteger(input.size) || input.size <= 0 || input.size > MAX_UPLOAD_SIZE) {
    throw new UploadError('size must be a whole number of bytes, up to 5 TiB.')
  }
  const sha256 = input.sha256?.toLowerCase()
  if (sha256 !== undefined && !/^[0-9a-f]{64}$/.test(sha256)) throw new UploadError('sha256 must be 64 hex characters.')

  if (sha256 && !input.allowDuplicate) {
    const existing = await env.DB.prepare("SELECT id FROM assets WHERE sha256 = ? AND deleted_at IS NULL AND status != 'uploading' LIMIT 1")
      .bind(sha256).first<{ id: string }>()
    if (existing) return { duplicateOf: existing.id }
  }

  const connection: Connection | null = input.connectionId ? await getConnection(env.DB, input.connectionId) : await defaultConnection(env.DB)
  if (!connection) throw new UploadError('No such storage connection.', 404, 'unknown_connection')
  const storageClass = input.storageClass ?? connection.defaultClass
  if (!isStorageClass(storageClass) || !connection.storageClasses.includes(storageClass)) {
    throw new UploadError(`${connection.name} does not offer the ${String(storageClass)} storage class.`)
  }

  const filename = safeFilename(input.filename)
  const mimeType = mimeTypeFor(filename, input.contentType)
  const assetId = randomId()
  const now = new Date()
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const key = connectionKey(connection, `originals/${month}/${assetId}/${filename}`)
  const provider = providerFor(env, connection)
  const multipartId = await provider.createMultipart(key, { contentType: mimeType, storageClass })

  const mode = provider.capabilities.presign ? 'direct' : 'proxied'
  if (mode === 'proxied' && input.size > MAX_PROXIED_UPLOAD_SIZE) {
    await provider.abortMultipart(key, multipartId).catch(() => {})
    throw new UploadError(`Files over ${Math.floor(MAX_PROXIED_UPLOAD_SIZE / 1024 ** 3)} GB need an S3 connection; ${connection.name} uploads through the Worker.`)
  }
  const partSize = partSizeFor(input.size)
  const partCount = Math.max(1, Math.ceil(input.size / partSize))
  const uploadId = randomId()
  const iso = now.toISOString()

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assets (id, owner_id, filename, mime_type, size, sha256, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`,
    ).bind(assetId, principal.userId, filename, mimeType, input.size, sha256 ?? null, iso, iso),
    env.DB.prepare(
      `INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).bind(assetId, connection.id, key, storageClass, iso),
    env.DB.prepare(
      `INSERT INTO uploads (id, asset_id, connection_id, key, multipart_id, mode, storage_class, part_size, part_count, size, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      uploadId, assetId, connection.id, key, multipartId, mode, storageClass, partSize, partCount, input.size,
      principal.userId, iso, new Date(now.getTime() + UPLOAD_TTL_DAYS * 86_400_000).toISOString(),
    ),
  ])
  return { uploadId, assetId, mode, partSize, partCount, storageClass, connectionId: connection.id }
}

/** The caller's upload, or an error. Uploads are private to whoever started them. */
export async function getUpload(db: D1Database, principal: Principal, uploadId: string): Promise<UploadRow> {
  const row = await db.prepare('SELECT * FROM uploads WHERE id = ?').bind(uploadId).first<UploadRow>()
  if (!row || row.created_by !== principal.userId) throw new UploadError('No such upload.', 404, 'not_found')
  if (row.expires_at <= nowIso()) throw new UploadError('This upload has expired. Start it again.', 409, 'expired')
  return row
}

function expectedPartSize(upload: UploadRow, partNumber: number): number {
  return partNumber < upload.part_count ? upload.part_size : upload.size - upload.part_size * (upload.part_count - 1)
}

function checkPartNumber(upload: UploadRow, partNumber: number): void {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > upload.part_count) {
    throw new UploadError(`Part numbers run from 1 to ${upload.part_count}.`)
  }
}

/** Where the client sends each part: presigned storage URLs, or this API for proxied uploads. */
export async function partTargets(env: DamBindings, upload: UploadRow, partNumbers: number[]): Promise<(PresignedRequest & { partNumber: number; size: number })[]> {
  if (partNumbers.length === 0 || partNumbers.length > 100) throw new UploadError('Ask for between 1 and 100 parts at a time.')
  partNumbers.forEach((n) => checkPartNumber(upload, n))
  if (upload.mode === 'proxied') {
    const expiresAt = upload.expires_at
    return partNumbers.map((partNumber) => ({
      partNumber,
      size: expectedPartSize(upload, partNumber),
      method: 'PUT' as const,
      url: `/api/uploads/${upload.id}/parts/${partNumber}`,
      headers: {},
      expiresAt,
    }))
  }
  const connection = await getConnection(env.DB, upload.connection_id)
  if (!connection) throw new UploadError('The storage connection for this upload no longer exists.', 409)
  const provider = providerFor(env, connection)
  if (!provider.presignPart) throw new StorageError('This connection cannot presign.', 'NoPresign')
  return Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      size: expectedPartSize(upload, partNumber),
      ...(await provider.presignPart!(upload.key, upload.multipart_id, partNumber, PART_URL_TTL_SECONDS)),
    })),
  )
}

/** One part through the Worker (proxied mode). */
export async function uploadProxiedPart(env: DamBindings, upload: UploadRow, partNumber: number, body: ReadableStream | null, contentLength: number): Promise<{ etag: string }> {
  if (upload.mode !== 'proxied') throw new UploadError('Send this upload’s parts to the URLs it was given.', 409)
  checkPartNumber(upload, partNumber)
  const expected = expectedPartSize(upload, partNumber)
  if (contentLength !== expected) throw new UploadError(`Part ${partNumber} must be exactly ${expected} bytes.`)
  if (!body) throw new UploadError('The part has no body.')
  const connection = await getConnection(env.DB, upload.connection_id)
  if (!connection) throw new UploadError('The storage connection for this upload no longer exists.', 409)
  return providerFor(env, connection).uploadPart(upload.key, upload.multipart_id, partNumber, body, contentLength)
}

export async function completeUpload(env: DamBindings, upload: UploadRow, parts: CompletedPart[]): Promise<string> {
  if (parts.length !== upload.part_count) throw new UploadError(`Expected ${upload.part_count} parts, got ${parts.length}.`)
  const numbers = new Set(parts.map((p) => p.partNumber))
  if (numbers.size !== upload.part_count || [...numbers].some((n) => n < 1 || n > upload.part_count)) {
    throw new UploadError('Each part number must appear exactly once.')
  }
  const connection = await getConnection(env.DB, upload.connection_id)
  if (!connection) throw new UploadError('The storage connection for this upload no longer exists.', 409)
  const provider = providerFor(env, connection)
  const { etag } = await provider.completeMultipart(upload.key, upload.multipart_id, parts)

  const head = await provider.head(upload.key)
  if (!head || head.size !== upload.size) {
    // The client declared one size and sent another: don't keep an asset that misstates itself.
    await provider.delete(upload.key)
    await env.DB.batch([
      env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(upload.id),
      env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(upload.asset_id),
    ])
    throw new UploadError(`The upload was ${head?.size ?? 0} bytes, not the ${upload.size} declared.`, 409, 'size_mismatch')
  }

  const now = nowIso()
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE asset_locations SET state = ?, storage_class = ?, size = ?, etag = ?, updated_at = ?
       WHERE asset_id = ? AND connection_id = ?`,
    ).bind('present', head.storageClass, head.size, etag, now, upload.asset_id, upload.connection_id),
    env.DB.prepare("UPDATE assets SET status = 'processing', updated_at = ? WHERE id = ?").bind(now, upload.asset_id),
    env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(upload.id),
  ])
  return upload.asset_id
}

export async function abortUpload(env: DamBindings, upload: UploadRow): Promise<void> {
  const connection = await getConnection(env.DB, upload.connection_id)
  if (connection) await providerFor(env, connection).abortMultipart(upload.key, upload.multipart_id).catch(() => {})
  await env.DB.batch([
    env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(upload.id),
    env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(upload.asset_id),
  ])
}
