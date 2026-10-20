/**
 * Archiving originals from a NAS or Mac to an S3 bucket, Deep Archive usually (plans/PLAN-5o-v1.md in
 * cf-dam-docs). The agent drives it file by file from its own list; cf-dam decides what to do with each
 * file, signs every part of the upload, completes it and records the copy. It never sees the bytes.
 *
 * Each part carries its SHA-256, signed into its URL: the bucket refuses a part whose bytes don't match,
 * so a copy is known good the moment it lands. That matters because a Deep Archive object can't be read
 * back cheaply to check it later.
 *
 * A duplicate (same size and fingerprint as a photo already archived, and the same SHA-256 once the agent
 * has hashed it) isn't uploaded again: its location points at the same object. cf-dam never deletes
 * originals; anything that ever does must look for other locations sharing the key first.
 */
import type { DamBindings } from '../env'
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { getConnection, providerFor, type Connection } from '../storage/connections'
import { isStorageClass, type StorageClass } from '../storage/types'
import { AgentError, type SourceRow } from './agents'
import { safeFilename } from './uploads'

export interface ArchiveSettings {
  /** The bucket originals go to; absent or null: not archiving. */
  connectionId?: string | null
  storageClass?: StorageClass
  /** Archive only between these hours, the agent's local time (from 22 to 7 crosses midnight). Equal: all day. */
  fromHour?: number
  toHour?: number
  /** Upload speed limit, megabits a second; 0 or absent: none. */
  maxMbps?: number
}

/** 64 MiB parts: big enough to be few, small enough to resume cheaply. S3 allows 10,000 parts. */
export const PART_SIZE = 64 * 1024 * 1024
const MAX_PARTS = 10_000
/** A part's signed URL lasts an hour: the agent asks for each one just before sending it. */
const PART_URL_SECONDS = 60 * 60
/** Uploads not completed in this long are given up (the bucket's lifecycle rule cleans up too). */
export const ARCHIVE_UPLOAD_DAYS = 7

export function parseArchiveSettings(value: string | null | undefined): ArchiveSettings {
  try {
    const parsed = JSON.parse(value ?? '{}') as ArchiveSettings
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** What the agent is told in its config: null when it isn't archiving. */
export function archiveConfig(source: SourceRow & { archive?: string }) {
  const s = parseArchiveSettings(source.archive)
  if (!s.connectionId) return null
  return { fromHour: s.fromHour ?? 0, toHour: s.toHour ?? 0, maxMbps: s.maxMbps ?? 0 }
}

/** Check settings a person submits; returns them cleaned. */
export async function validArchiveSettings(db: D1Database, input: unknown): Promise<ArchiveSettings> {
  if (input === null) return {}
  if (!input || typeof input !== 'object') throw new AgentError('archive must be an object, or null to stop archiving.')
  const s = input as Record<string, unknown>
  const hour = (v: unknown, name: string) => {
    if (v === undefined) return 0
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 23) throw new AgentError(`${name} must be a whole hour, 0 to 23.`)
    return v as number
  }
  if (s.connectionId === null || s.connectionId === undefined) return {}
  if (typeof s.connectionId !== 'string') throw new AgentError('connectionId must be a storage connection id.')
  const connection = await getConnection(db, s.connectionId)
  if (!connection || connection.provider !== 's3') throw new AgentError('Archive to an S3 bucket: add one on the Storage page first.')
  const storageClass = s.storageClass ?? connection.defaultClass
  if (!isStorageClass(storageClass) || !connection.storageClasses.includes(storageClass)) {
    throw new AgentError(`${connection.name} doesn't offer the ${String(storageClass)} storage class.`)
  }
  const maxMbps = s.maxMbps ?? 0
  if (typeof maxMbps !== 'number' || maxMbps < 0 || maxMbps > 100_000) throw new AgentError('maxMbps must be 0 (no limit) or a speed in megabits a second.')
  return { connectionId: connection.id, storageClass, fromHour: hour(s.fromHour, 'fromHour'), toHour: hour(s.toHour, 'toHour'), maxMbps }
}

async function target(env: DamBindings, source: SourceRow & { archive?: string }): Promise<{ settings: ArchiveSettings; connection: Connection }> {
  const settings = parseArchiveSettings(source.archive)
  if (!settings.connectionId) throw new AgentError('This agent isn\'t archiving: choose a bucket for it in cf-dam.', 409)
  const connection = await getConnection(env.DB, settings.connectionId)
  if (!connection || connection.provider !== 's3') throw new AgentError('The archive bucket no longer exists in cf-dam.', 409)
  return { settings, connection }
}

interface NasLocation {
  key: string
  size: number | null
  quick_hash: string | null
  filename: string
  sha256: string | null
}

async function nasLocation(db: D1Database, source: SourceRow, assetId: string): Promise<NasLocation> {
  const row = await db
    .prepare(
      `SELECT l.key, l.size, l.quick_hash, a.filename, a.sha256 FROM asset_locations l JOIN assets a ON a.id = l.asset_id
       WHERE l.asset_id = ? AND l.connection_id = ? AND l.state = 'present' AND a.deleted_at IS NULL`,
    )
    .bind(assetId, source.connection_id)
    .first<NasLocation>()
  if (!row) throw new AgentError('No such photo on this agent.', 404)
  return row
}

const hex64 = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !/^[0-9a-f]{64}$/i.test(v)) throw new AgentError(`${name} must be 64 hex characters (a SHA-256).`)
  return v.toLowerCase()
}
const base64Sha = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(v)) throw new AgentError(`${name} must be a SHA-256 in base64.`)
  return v
}

export type StartResult =
  | { result: 'archived' }
  | { result: 'verify'; sha256: string; fromAssetId: string }
  | { result: 'upload'; uploadId: string; partSize: number; partCount: number }

/**
 * What to do with one file: nothing (its copy is there), hash it and link it to an identical copy, or
 * upload it. `size` and `quickHash` are the file as the agent sees it now, and must match what it
 * indexed: a file changed since is indexed again first.
 */
export async function startArchive(env: DamBindings, source: SourceRow & { archive?: string }, body: Record<string, unknown>): Promise<StartResult> {
  const db = env.DB
  const assetId = String(body.assetId ?? '')
  const size = body.size
  const quickHash = body.quickHash
  if (!Number.isInteger(size) || (size as number) < 0) throw new AgentError('size must be the file\'s size in bytes.')
  if (typeof quickHash !== 'string' || !/^[0-9a-f]{16,64}$/.test(quickHash)) throw new AgentError('quickHash must be the file\'s fingerprint.')
  const { settings, connection } = await target(env, source)
  const nas = await nasLocation(db, source, assetId)
  if (nas.size !== size || nas.quick_hash !== quickHash) throw new AgentError('The file changed since it was indexed; it is archived after the next scan.', 409)

  // Already archived, as this very file.
  const mine = await db
    .prepare("SELECT size, quick_hash FROM asset_locations WHERE asset_id = ? AND connection_id = ? AND state != 'gone'")
    .bind(assetId, connection.id)
    .first<{ size: number | null; quick_hash: string | null }>()
  if (mine && mine.size === size && mine.quick_hash === quickHash) return { result: 'archived' }

  // The same file archived for another photo: the agent proves it with the whole SHA-256.
  const twin = await db
    .prepare(
      `SELECT l.asset_id, a.sha256 FROM asset_locations l JOIN assets a ON a.id = l.asset_id
       WHERE l.connection_id = ? AND l.quick_hash = ? AND l.size = ? AND l.storage_class != 'NAS' AND l.state != 'gone'
         AND l.asset_id != ? AND a.sha256 IS NOT NULL LIMIT 1`,
    )
    .bind(connection.id, quickHash, size, assetId)
    .first<{ asset_id: string; sha256: string }>()
  if (twin) return { result: 'verify', sha256: twin.sha256, fromAssetId: twin.asset_id }

  // An upload already under way for this file (the agent lost track of it): start afresh.
  await abandonUploads(env, db.prepare('SELECT * FROM archive_uploads WHERE asset_id = ?').bind(assetId))

  const base = Number(env.ARCHIVE_PART_BYTES) || PART_SIZE
  const partSize = Math.max(base, Math.ceil((size as number) / MAX_PARTS / (1024 * 1024)) * 1024 * 1024)
  const partCount = Math.max(1, Math.ceil((size as number) / partSize))
  const startedAt = nowIso()
  const key = `originals/${assetId}/${startedAt.replace(/[:.]/g, '-')}-${safeFilename(nas.filename)}`
  const storageClass = settings.storageClass ?? connection.defaultClass
  const multipartId = await providerFor(env, connection).createMultipart(key, { storageClass: storageClass as StorageClass, checksumSha256: true })
  const id = randomId()
  await db
    .prepare(
      `INSERT INTO archive_uploads (id, source_id, asset_id, connection_id, key, multipart_id, storage_class, size, quick_hash, part_size, part_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, source.id, assetId, connection.id, key, multipartId, storageClass, size, quickHash, partSize, partCount, startedAt)
    .run()
  return { result: 'upload', uploadId: id, partSize, partCount }
}

interface UploadRow {
  id: string
  source_id: string
  asset_id: string
  connection_id: string
  key: string
  multipart_id: string
  storage_class: string
  size: number
  quick_hash: string
  part_size: number
  part_count: number
  created_at: string
}

async function upload(db: D1Database, source: SourceRow, id: unknown): Promise<UploadRow> {
  const row = await db.prepare('SELECT * FROM archive_uploads WHERE id = ? AND source_id = ?').bind(String(id ?? ''), source.id).first<UploadRow>()
  if (!row) throw new AgentError('No such upload: it finished, or was given up. Start the file again.', 404)
  return row
}

/** A signed URL for one part, carrying the part's SHA-256 (base64): the bucket refuses other bytes. */
export async function signArchivePart(env: DamBindings, source: SourceRow, body: Record<string, unknown>) {
  const row = await upload(env.DB, source, body.uploadId)
  const partNumber = body.partNumber
  if (!Number.isInteger(partNumber) || (partNumber as number) < 1 || (partNumber as number) > row.part_count) {
    throw new AgentError(`partNumber must be 1 to ${row.part_count}.`)
  }
  const checksum = base64Sha(body.checksum, 'checksum')
  const connection = await getConnection(env.DB, row.connection_id)
  if (!connection) throw new AgentError('The archive bucket no longer exists in cf-dam.', 409)
  const signed = await providerFor(env, connection).presignPart!(row.key, row.multipart_id, partNumber as number, PART_URL_SECONDS, { checksumSha256: checksum })
  return { url: signed.url, headers: signed.headers }
}

/**
 * Finish an upload: complete it with every part's checksum, check its size, and record the copy as a
 * location of the photo, with the photo's SHA-256 as the agent computed it from the bytes it sent.
 */
export async function completeArchive(env: DamBindings, source: SourceRow, body: Record<string, unknown>) {
  const db = env.DB
  const row = await upload(db, source, body.uploadId)
  const sha256 = hex64(body.sha256, 'sha256')
  const parts = Array.isArray(body.parts) ? body.parts : []
  if (parts.length !== row.part_count) throw new AgentError(`Expected ${row.part_count} parts, got ${parts.length}.`)
  const completed = parts.map((p: Record<string, unknown>) => ({
    partNumber: Number(p.partNumber),
    etag: String(p.etag ?? ''),
    checksumSha256: base64Sha(p.checksum, 'checksum'),
  }))
  if (new Set(completed.map((p) => p.partNumber)).size !== row.part_count || completed.some((p) => p.partNumber < 1 || p.partNumber > row.part_count || !p.etag)) {
    throw new AgentError('Each part number must appear once, with its ETag.')
  }
  const connection = await getConnection(db, row.connection_id)
  if (!connection) throw new AgentError('The archive bucket no longer exists in cf-dam.', 409)
  const provider = providerFor(env, connection)
  const { etag } = await provider.completeMultipart(row.key, row.multipart_id, completed)
  const head = await provider.head(row.key)
  if (!head || head.size !== row.size) {
    throw new AgentError(`The bucket holds ${head?.size ?? 0} bytes, not the file's ${row.size}. Start the file again.`, 409)
  }
  const now = nowIso()
  await db.batch([
    db
      .prepare(
        `INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, size, etag, quick_hash, updated_at)
         VALUES (?, ?, ?, ?, 'present', ?, ?, ?, ?)
         ON CONFLICT (asset_id, connection_id) DO UPDATE SET key = excluded.key, storage_class = excluded.storage_class, state = 'present',
           size = excluded.size, etag = excluded.etag, quick_hash = excluded.quick_hash, updated_at = excluded.updated_at,
           checked_at = NULL, check_due_at = NULL, check_result = NULL, check_detail = NULL`,
      )
      .bind(row.asset_id, row.connection_id, row.key, head.storageClass, head.size, etag || head.etag, row.quick_hash, now),
    // Computed from the bytes the bucket checked part by part: as good as verified.
    db.prepare('UPDATE assets SET sha256 = ?, sha256_verified = 1, updated_at = ? WHERE id = ?').bind(sha256, now, row.asset_id),
    db.prepare('DELETE FROM archive_uploads WHERE id = ?').bind(row.id),
  ])
  return { archived: true, key: row.key }
}

/** A duplicate: point this photo at the copy of an identical file, which the agent proved by its SHA-256. */
export async function linkArchive(env: DamBindings, source: SourceRow & { archive?: string }, body: Record<string, unknown>) {
  const db = env.DB
  const assetId = String(body.assetId ?? '')
  const sha256 = hex64(body.sha256, 'sha256')
  const { connection } = await target(env, source)
  const nas = await nasLocation(db, source, assetId)
  const twin = await db
    .prepare(
      `SELECT l.key, l.storage_class, l.size, l.etag, l.quick_hash FROM asset_locations l JOIN assets a ON a.id = l.asset_id
       WHERE l.asset_id = ? AND l.connection_id = ? AND l.state != 'gone' AND a.sha256 = ?`,
    )
    .bind(String(body.fromAssetId ?? ''), connection.id, sha256)
    .first<{ key: string; storage_class: string; size: number; etag: string | null; quick_hash: string | null }>()
  if (!twin || twin.size !== nas.size || twin.quick_hash !== nas.quick_hash) throw new AgentError('That copy doesn\'t match this file: upload it instead.', 409)
  const now = nowIso()
  await db.batch([
    db
      .prepare(
        `INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, size, etag, quick_hash, updated_at)
         VALUES (?, ?, ?, ?, 'present', ?, ?, ?, ?)
         ON CONFLICT (asset_id, connection_id) DO UPDATE SET key = excluded.key, storage_class = excluded.storage_class, state = 'present',
           size = excluded.size, etag = excluded.etag, quick_hash = excluded.quick_hash, updated_at = excluded.updated_at`,
      )
      .bind(assetId, connection.id, twin.key, twin.storage_class, twin.size, twin.etag, twin.quick_hash, now),
    db.prepare('UPDATE assets SET sha256 = ?, updated_at = ? WHERE id = ?').bind(sha256, now, assetId),
  ])
  return { archived: true, linked: true }
}

/** Give up uploads (the store's part of them too), e.g. a file that changed mid-upload. */
async function abandonUploads(env: DamBindings, query: D1PreparedStatement): Promise<number> {
  const { results } = await query.all<UploadRow>()
  for (const row of results) {
    const connection = await getConnection(env.DB, row.connection_id)
    if (connection) await providerFor(env, connection).abortMultipart(row.key, row.multipart_id).catch(() => {})
    await env.DB.prepare('DELETE FROM archive_uploads WHERE id = ?').bind(row.id).run()
  }
  return results.length
}

export async function abortArchive(env: DamBindings, source: SourceRow, body: Record<string, unknown>) {
  const row = await upload(env.DB, source, body.uploadId)
  await abandonUploads(env, env.DB.prepare('SELECT * FROM archive_uploads WHERE id = ?').bind(row.id))
  return { aborted: true }
}

/** For the sweep: uploads left for a week are given up. */
export async function abandonStaleArchiveUploads(env: DamBindings): Promise<number> {
  const cutoff = new Date(Date.now() - ARCHIVE_UPLOAD_DAYS * 86_400_000).toISOString()
  return abandonUploads(env, env.DB.prepare('SELECT * FROM archive_uploads WHERE created_at < ? LIMIT 20').bind(cutoff))
}
