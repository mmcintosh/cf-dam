/** Asset records, their locations, tags and the list query. */
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { indexAsset, toFtsQuery } from './search'

export interface AssetRow {
  id: string
  owner_id: string | null
  filename: string
  title: string | null
  caption: string | null
  alt: string | null
  mime_type: string
  size: number
  sha256: string | null
  sha256_verified: number
  width: number | null
  height: number | null
  orientation: number | null
  captured_at: string | null
  captured_offset: string | null
  camera_make: string | null
  camera_model: string | null
  lens: string | null
  focal_length: number | null
  aperture: number | null
  exposure_time: number | null
  iso: number | null
  gps_lat: number | null
  gps_lng: number | null
  rating: number | null
  metadata: string | null
  status: string
  error: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface LocationRow {
  asset_id: string
  connection_id: string
  key: string
  storage_class: string
  state: string
  restore_expires_at: string | null
  size: number | null
  etag: string | null
  updated_at: string
}

export async function getAsset(db: D1Database, id: string): Promise<AssetRow | null> {
  return db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').bind(id).first<AssetRow>()
}

export async function getLocations(db: D1Database, assetId: string): Promise<LocationRow[]> {
  const { results } = await db.prepare('SELECT * FROM asset_locations WHERE asset_id = ? ORDER BY connection_id').bind(assetId).all<LocationRow>()
  return results
}

/** The location to read the original from: a present one, the built-in R2 first. */
export function primaryLocation(locations: LocationRow[]): LocationRow | null {
  const usable = locations.filter((l) => l.state !== 'pending' && l.state !== 'gone')
  return usable.find((l) => l.connection_id === 'r2') ?? usable[0] ?? null
}

export async function getTags(db: D1Database, assetId: string): Promise<{ name: string; source: string }[]> {
  const { results } = await db
    .prepare('SELECT t.name, at.source FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = ? ORDER BY t.name')
    .bind(assetId)
    .all<{ name: string; source: string }>()
  return results
}

export function normalizeTag(name: string): string | null {
  const tag = name.normalize('NFKC').replace(/\s+/g, ' ').trim()
  return tag.length > 0 && tag.length <= 80 ? tag : null
}

/** Add tags (creating them as needed). `source` records where a tag came from: user, import, ai. */
export async function addTags(db: D1Database, assetId: string, names: string[], source: 'user' | 'import' | 'ai'): Promise<void> {
  const tags = [...new Set(names.map(normalizeTag).filter((t): t is string => t !== null))]
  if (tags.length === 0) return
  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  for (const tag of tags) {
    statements.push(db.prepare('INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)').bind(randomId(), tag, now))
    statements.push(
      db
        .prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, source, created_at) SELECT ?, id, ?, ? FROM tags WHERE name = ?')
        .bind(assetId, source, now, tag),
    )
  }
  await db.batch(statements)
}

/** Replace an asset's tags with exactly `names`. */
export async function setTags(db: D1Database, assetId: string, names: string[]): Promise<void> {
  await db.prepare('DELETE FROM asset_tags WHERE asset_id = ?').bind(assetId).run()
  await addTags(db, assetId, names, 'user')
}

export interface AssetJson {
  id: string
  filename: string
  title: string | null
  caption: string | null
  alt: string | null
  mimeType: string
  size: number
  sha256: string | null
  width: number | null
  height: number | null
  capturedAt: string | null
  capturedOffset: string | null
  camera: { make: string | null; model: string | null; lens: string | null }
  exposure: { focalLength: number | null; aperture: number | null; exposureTime: number | null; iso: number | null }
  gps: { lat: number; lng: number } | null
  rating: number | null
  status: string
  error: string | null
  renditions: string[]
  createdAt: string
  updatedAt: string
}

export function assetJson(row: AssetRow, renditions: string[]): AssetJson {
  return {
    id: row.id,
    filename: row.filename,
    title: row.title,
    caption: row.caption,
    alt: row.alt,
    mimeType: row.mime_type,
    size: row.size,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    capturedAt: row.captured_at,
    capturedOffset: row.captured_offset,
    camera: { make: row.camera_make, model: row.camera_model, lens: row.lens },
    exposure: { focalLength: row.focal_length, aperture: row.aperture, exposureTime: row.exposure_time, iso: row.iso },
    gps: row.gps_lat !== null && row.gps_lng !== null ? { lat: row.gps_lat, lng: row.gps_lng } : null,
    rating: row.rating,
    status: row.status,
    error: row.error,
    renditions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function renditionNames(db: D1Database, assetIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (assetIds.length === 0) return map
  const placeholders = assetIds.map(() => '?').join(',')
  const { results } = await db
    .prepare(`SELECT asset_id, name FROM renditions WHERE asset_id IN (${placeholders})`)
    .bind(...assetIds)
    .all<{ asset_id: string; name: string }>()
  for (const row of results) map.set(row.asset_id, [...(map.get(row.asset_id) ?? []), row.name])
  return map
}

export interface ListFilters {
  q?: string
  tag?: string
  camera?: string
  albumId?: string
  from?: string
  to?: string
  sort?: 'captured' | 'added'
  limit?: number
  offset?: number
}

export async function listAssets(db: D1Database, filters: ListFilters): Promise<{ assets: AssetJson[]; total: number }> {
  const where: string[] = ["a.deleted_at IS NULL", "a.status != 'uploading'"]
  const params: unknown[] = []
  const fts = filters.q ? toFtsQuery(filters.q) : null
  if (fts) {
    where.push('a.id IN (SELECT asset_id FROM assets_fts WHERE assets_fts MATCH ?)')
    params.push(fts)
  }
  if (filters.tag) {
    where.push('a.id IN (SELECT at.asset_id FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE t.name = ?)')
    params.push(filters.tag)
  }
  if (filters.camera) {
    where.push('a.camera_model = ?')
    params.push(filters.camera)
  }
  if (filters.albumId) {
    where.push('a.id IN (SELECT asset_id FROM album_items WHERE album_id = ?)')
    params.push(filters.albumId)
  }
  if (filters.from) {
    where.push('a.captured_at >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    where.push('a.captured_at <= ?')
    params.push(filters.to)
  }
  const order =
    filters.sort === 'added' ? 'a.created_at DESC, a.id DESC' : 'COALESCE(a.captured_at, a.created_at) DESC, a.id DESC'
  const limit = Math.min(Math.max(filters.limit ?? 60, 1), 200)
  const offset = Math.max(filters.offset ?? 0, 0)
  const clause = where.join(' AND ')

  const [rows, count] = await db.batch([
    db.prepare(`SELECT a.* FROM assets a WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...params, limit, offset),
    db.prepare(`SELECT COUNT(*) AS n FROM assets a WHERE ${clause}`).bind(...params),
  ])
  const assets = (rows!.results ?? []) as AssetRow[]
  const renditions = await renditionNames(db, assets.map((a) => a.id))
  return {
    assets: assets.map((row) => assetJson(row, renditions.get(row.id) ?? [])),
    total: ((count!.results?.[0] as { n: number } | undefined)?.n) ?? 0,
  }
}

export async function updateAsset(
  db: D1Database,
  id: string,
  patch: { title?: string | null; caption?: string | null; alt?: string | null; rating?: number | null; tags?: string[] },
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []
  for (const [field, column] of [['title', 'title'], ['caption', 'caption'], ['alt', 'alt'], ['rating', 'rating']] as const) {
    if (patch[field] !== undefined) {
      sets.push(`${column} = ?`)
      params.push(patch[field])
    }
  }
  if (sets.length > 0) {
    await db.prepare(`UPDATE assets SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...params, nowIso(), id).run()
  }
  if (patch.tags !== undefined) await setTags(db, id, patch.tags)
  await indexAsset(db, id)
}

export async function softDeleteAsset(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(nowIso(), nowIso(), id),
    db.prepare('DELETE FROM assets_fts WHERE asset_id = ?').bind(id),
  ])
}
