/** Asset records, their locations, tags and the list query. */
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { iptcJson, iptcUpdate, type IptcKey, type IptcValues } from './iptc'
import { displayPath, keywordFilterSql, resolveKeyword } from './keywords'
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
  flag: string | null
  label: string | null
  metadata: string | null
  status: string
  error: string | null
  ai_status: string | null
  ai_model: string | null
  ai_analyzed_at: string | null
  ai_alt: string | null
  ai_caption: string | null
  ai_description: string | null
  ai_quality: string | null
  ai_people: number | null
  ai_neurons: number | null
  ai_error: string | null
  ai_text: string | null
  headline: string | null
  creator: string | null
  creator_title: string | null
  credit: string | null
  source: string | null
  copyright: string | null
  usage_terms: string | null
  copyright_url: string | null
  contact_email: string | null
  contact_phone: string | null
  contact_url: string | null
  job_id: string | null
  instructions: string | null
  sublocation: string | null
  city: string | null
  state: string | null
  country: string | null
  country_code: string | null
  location_source: string | null
  duration: number | null
  video_codec: string | null
  frame_rate: number | null
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

export interface AssetTag {
  id: string
  name: string
  /** Display path ('Places › Norway › Bergen'); the name alone for a top-level keyword. */
  path: string
  source: string
}

export async function getTags(db: D1Database, assetId: string): Promise<AssetTag[]> {
  const { results } = await db
    .prepare('SELECT t.id, t.name, t.full_path, at.source FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = ? ORDER BY t.path')
    .bind(assetId)
    .all<{ id: string; name: string; full_path: string; source: string }>()
  return results.map((r) => ({ id: r.id, name: r.name, path: displayPath(r.full_path), source: r.source }))
}

/** Resolve names or paths to keyword ids, creating keywords as needed (see resolveKeyword). */
async function resolveAll(db: D1Database, names: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const name of [...new Set(names)].slice(0, 200)) {
    const id = await resolveKeyword(db, name)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * Add keywords by name or path (`Places > Norway > Oslo`), creating them as needed. `source` records
 * where a tag came from: user, import, ai, lightroom.
 */
export async function addTags(db: D1Database, assetId: string, names: string[], source: 'user' | 'import' | 'ai' | 'lightroom'): Promise<void> {
  const ids = await resolveAll(db, names)
  if (ids.length === 0) return
  const now = nowIso()
  await db.batch(ids.map((id) => db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, source, created_at) VALUES (?, ?, ?, ?)').bind(assetId, id, source, now)))
}

/**
 * Replace an asset's own tags with exactly `names`. AI suggestions are kept apart (they are accepted
 * or removed on their own), except that naming one here makes it the person's own.
 */
export async function setTags(db: D1Database, assetId: string, names: string[]): Promise<void> {
  const ids = await resolveAll(db, names)
  const now = nowIso()
  await db.batch([
    db.prepare("DELETE FROM asset_tags WHERE asset_id = ? AND source != 'ai'").bind(assetId),
    ...ids.map((id) =>
      db
        .prepare("INSERT INTO asset_tags (asset_id, tag_id, source, created_at) VALUES (?, ?, 'user', ?) ON CONFLICT (asset_id, tag_id) DO UPDATE SET source = 'user'")
        .bind(assetId, id, now),
    ),
  ])
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
  flag: 'pick' | 'reject' | null
  label: Label | null
  status: string
  error: string | null
  renditions: string[]
  /** Where the original lives (the primary location), when known. */
  storage: { connectionId: string; storageClass: string; state: string } | null
  /** AI review: suggestions kept apart from what people wrote. */
  ai: {
    status: string | null
    model: string | null
    analyzedAt: string | null
    alt: string | null
    caption: string | null
    description: string | null
    quality: string | null
    people: number | null
    /** Text visible in the picture (signs, documents), read by the vision model. */
    text: string | null
    error: string | null
  }
  /** IPTC Core: credit, rights, contact, place, job. */
  iptc: Record<IptcKey, string | null>
  /** Where city/state/country came from: file, user or gps. */
  locationSource: string | null
  /** Videos: length in seconds, codec, frames per second. Null for photos. */
  video: { duration: number | null; codec: string | null; frameRate: number | null } | null
  createdAt: string
  updatedAt: string
}

export function assetJson(row: AssetRow, renditions: string[], location: LocationRow | null = null): AssetJson {
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
    flag: row.flag === 'pick' || row.flag === 'reject' ? row.flag : null,
    label: isLabel(row.label) ? row.label : null,
    status: row.status,
    error: row.error,
    renditions,
    storage: location ? { connectionId: location.connection_id, storageClass: location.storage_class, state: location.state } : null,
    ai: {
      status: row.ai_status ?? null,
      model: row.ai_model ?? null,
      analyzedAt: row.ai_analyzed_at ?? null,
      alt: row.ai_alt ?? null,
      caption: row.ai_caption ?? null,
      description: row.ai_description ?? null,
      quality: row.ai_quality ?? null,
      people: row.ai_people ?? null,
      text: row.ai_text ?? null,
      error: row.ai_error ?? null,
    },
    iptc: iptcJson(row as unknown as Record<string, unknown>),
    locationSource: row.location_source ?? null,
    video: row.mime_type.startsWith('video/') ? { duration: row.duration ?? null, codec: row.video_codec ?? null, frameRate: row.frame_rate ?? null } : null,
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
  lens?: string
  albumId?: string
  from?: string
  to?: string
  /** "2024" */
  year?: string
  /** "2024-06" */
  month?: string
  /** Minimum stars, 1–5. */
  rating?: number
  flag?: 'pick' | 'reject' | 'none'
  label?: Label | 'none'
  country?: string
  city?: string
  creator?: string
  /** Has GPS ('some') or not ('none'). */
  gps?: 'some' | 'none'
  /** Stored on this connection (a NAS agent's, R2, an S3 bucket). */
  storedOn?: string
  /** A copy of the original is missing (not found in a NAS agent's last scan). */
  missing?: boolean
  orientation?: Orientation
  type?: FileKind
  tier?: Tier
  sort?: 'captured' | 'added'
  limit?: number
  offset?: number
}

export type Orientation = 'landscape' | 'portrait' | 'square'
/** Colour labels, as in Lightroom. Their display names are a setting (labels.names). */
export const LABELS = ['red', 'yellow', 'green', 'blue', 'purple'] as const
export type Label = (typeof LABELS)[number]
export const isLabel = (value: unknown): value is Label => typeof value === 'string' && (LABELS as readonly string[]).includes(value)
export type FileKind = 'photo' | 'raw' | 'video' | 'other'
/** Where the original lives: on a NAS (indexed in place), or a cloud tier from hot to deep archive. */
export type Tier = 'nas' | 'hot' | 'warm' | 'cold' | 'deep'

/** SQL for the facets that are computed rather than stored. Each is an expression over `a`. */
export const ORIENTATION_SQL = `CASE WHEN a.width IS NULL OR a.height IS NULL THEN NULL
  WHEN a.width > a.height * 1.05 THEN 'landscape' WHEN a.height > a.width * 1.05 THEN 'portrait' ELSE 'square' END`
export const KIND_SQL = `CASE WHEN a.mime_type LIKE 'video/%' THEN 'video' WHEN a.mime_type LIKE 'image/x-%' THEN 'raw'
  WHEN a.mime_type LIKE 'image/%' AND a.mime_type != 'image/svg+xml' THEN 'photo' ELSE 'other' END`
export const TIER_CLASSES: Record<Tier, string[]> = {
  nas: ['NAS'],
  hot: ['STANDARD'],
  warm: ['STANDARD_IA', 'ONEZONE_IA', 'INTELLIGENT_TIERING'],
  cold: ['GLACIER_IR', 'GLACIER'],
  deep: ['DEEP_ARCHIVE'],
}
export const TIER_SQL = `(SELECT CASE l.storage_class WHEN 'NAS' THEN 'nas' WHEN 'STANDARD' THEN 'hot' WHEN 'DEEP_ARCHIVE' THEN 'deep'
  WHEN 'GLACIER' THEN 'cold' WHEN 'GLACIER_IR' THEN 'cold' ELSE 'warm' END
  FROM asset_locations l WHERE l.asset_id = a.id AND l.state NOT IN ('pending', 'gone')
  ORDER BY l.connection_id = 'r2' DESC LIMIT 1)`

/**
 * WHERE clause and parameters for a set of filters. Shared by the list, the facet counts, the
 * timeline and the map, so they always describe the same set of assets.
 * `omit` leaves one filter out: a facet's own counts ignore that facet's current choice.
 */
export function buildWhere(filters: ListFilters, omit?: keyof ListFilters): { clause: string; params: unknown[] } {
  const where: string[] = ["a.deleted_at IS NULL", "a.status != 'uploading'"]
  const params: unknown[] = []
  const use = (key: keyof ListFilters) => key !== omit && filters[key] !== undefined && filters[key] !== ''
  const fts = use('q') ? toFtsQuery(filters.q!) : null
  if (fts) {
    where.push('a.id IN (SELECT asset_id FROM assets_fts WHERE assets_fts MATCH ?)')
    params.push(fts)
  }
  if (use('tag')) {
    const { sql, params: tagParams } = keywordFilterSql(filters.tag!)
    where.push(sql)
    params.push(...tagParams)
  }
  if (use('camera')) {
    where.push('a.camera_model = ?')
    params.push(filters.camera)
  }
  if (use('lens')) {
    where.push('a.lens = ?')
    params.push(filters.lens)
  }
  if (use('albumId')) {
    where.push('a.id IN (SELECT asset_id FROM album_items WHERE album_id = ?)')
    params.push(filters.albumId)
  }
  if (use('from')) {
    where.push('a.captured_at >= ?')
    params.push(filters.from)
  }
  if (use('to')) {
    where.push('a.captured_at <= ?')
    params.push(filters.to)
  }
  if (use('year')) {
    where.push(filters.year === 'undated' ? 'a.captured_at IS NULL' : 'substr(a.captured_at, 1, 4) = ?')
    if (filters.year !== 'undated') params.push(filters.year)
  }
  if (use('month')) {
    where.push('substr(a.captured_at, 1, 7) = ?')
    params.push(filters.month)
  }
  if (use('rating')) {
    where.push('a.rating >= ?')
    params.push(filters.rating)
  }
  if (use('flag')) {
    where.push(filters.flag === 'none' ? 'a.flag IS NULL' : 'a.flag = ?')
    if (filters.flag !== 'none') params.push(filters.flag)
  }
  for (const key of ['country', 'city', 'creator'] as const) {
    if (use(key)) {
      where.push(`a.${key} = ?`)
      params.push(filters[key])
    }
  }
  if (use('storedOn')) {
    where.push(`a.id IN (SELECT asset_id FROM asset_locations WHERE connection_id = ? AND state != 'gone')`)
    params.push(filters.storedOn)
  }
  if (filters.missing && omit !== 'missing') where.push(`a.id IN (SELECT asset_id FROM asset_locations WHERE state = 'missing')`)
  if (use('gps')) where.push(filters.gps === 'none' ? 'a.gps_lat IS NULL' : 'a.gps_lat IS NOT NULL')
  if (use('label')) {
    where.push(filters.label === 'none' ? 'a.label IS NULL' : 'a.label = ?')
    if (filters.label !== 'none') params.push(filters.label)
  }
  if (use('orientation')) {
    where.push(`(${ORIENTATION_SQL}) = ?`)
    params.push(filters.orientation)
  }
  if (use('type')) {
    where.push(`(${KIND_SQL}) = ?`)
    params.push(filters.type)
  }
  if (use('tier')) {
    const classes = TIER_CLASSES[filters.tier!] ?? []
    where.push(
      `a.id IN (SELECT asset_id FROM asset_locations WHERE state NOT IN ('pending', 'gone') AND storage_class IN (${classes.map(() => '?').join(',')}))`,
    )
    params.push(...classes)
  }
  return { clause: where.join(' AND '), params }
}

export async function listAssets(db: D1Database, filters: ListFilters): Promise<{ assets: AssetJson[]; total: number }> {
  const { clause, params } = buildWhere(filters)
  const order =
    filters.sort === 'added' ? 'a.created_at DESC, a.id DESC' : 'COALESCE(a.captured_at, a.created_at) DESC, a.id DESC'
  const limit = Math.min(Math.max(filters.limit ?? 60, 1), 200)
  const offset = Math.max(filters.offset ?? 0, 0)

  const [rows, count] = await db.batch([
    db.prepare(`SELECT a.* FROM assets a WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...params, limit, offset),
    db.prepare(`SELECT COUNT(*) AS n FROM assets a WHERE ${clause}`).bind(...params),
  ])
  const assets = (rows!.results ?? []) as AssetRow[]
  const ids = assets.map((a) => a.id)
  const renditions = await renditionNames(db, ids)
  const locations = new Map<string, LocationRow[]>()
  if (ids.length > 0) {
    const { results } = await db
      .prepare(`SELECT * FROM asset_locations WHERE asset_id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all<LocationRow>()
    for (const row of results) locations.set(row.asset_id, [...(locations.get(row.asset_id) ?? []), row])
  }
  return {
    assets: assets.map((row) => assetJson(row, renditions.get(row.id) ?? [], primaryLocation(locations.get(row.id) ?? []))),
    total: ((count!.results?.[0] as { n: number } | undefined)?.n) ?? 0,
  }
}

export async function updateAsset(
  db: D1Database,
  id: string,
  patch: {
    title?: string | null
    caption?: string | null
    alt?: string | null
    rating?: number | null
    flag?: 'pick' | 'reject' | null
    label?: Label | null
    filename?: string
    tags?: string[]
    iptc?: IptcValues
  },
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []
  const fields = [['title', 'title'], ['caption', 'caption'], ['alt', 'alt'], ['rating', 'rating'], ['flag', 'flag'], ['label', 'label'], ['filename', 'filename']] as const
  for (const [field, column] of fields) {
    if (patch[field] !== undefined) {
      sets.push(`${column} = ?`)
      params.push(patch[field])
    }
  }
  if (sets.length > 0) {
    await db.prepare(`UPDATE assets SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...params, nowIso(), id).run()
  }
  const iptc = patch.iptc ? iptcUpdate(db, id, patch.iptc, { locationSource: 'user' }) : null
  if (iptc) await iptc.run()
  if (patch.tags !== undefined) await setTags(db, id, patch.tags)
  await indexAsset(db, id)
}

export async function softDeleteAsset(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(nowIso(), nowIso(), id),
    db.prepare('DELETE FROM assets_fts WHERE asset_id = ?').bind(id),
  ])
}

const ORIENTATIONS = new Set(['landscape', 'portrait', 'square'])
const KINDS = new Set(['photo', 'raw', 'video', 'other'])
const TIERS = new Set(['nas', 'hot', 'warm', 'cold', 'deep'])

/** Filters from URL query parameters (the API and the library pages share this). Unknown values are dropped. */
export function parseListFilters(query: Record<string, string | undefined>): ListFilters {
  const text = (v: string | undefined, max = 200) => (v && v.length <= max ? v : undefined)
  const int = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined)
  const rating = int(query.rating)
  return {
    q: text(query.q),
    tag: text(query.tag),
    camera: text(query.camera),
    lens: text(query.lens),
    albumId: text(query.album, 64),
    from: text(query.from, 30),
    to: text(query.to, 30),
    year: query.year && (/^\d{4}$/.test(query.year) || query.year === 'undated') ? query.year : undefined,
    month: query.month && /^\d{4}-\d{2}$/.test(query.month) ? query.month : undefined,
    rating: rating && rating >= 1 && rating <= 5 ? rating : undefined,
    flag: query.flag === 'pick' || query.flag === 'reject' || query.flag === 'none' ? query.flag : undefined,
    label: isLabel(query.label) || query.label === 'none' ? (query.label as Label | 'none') : undefined,
    country: text(query.country),
    city: text(query.city),
    creator: text(query.creator),
    gps: query.gps === 'none' || query.gps === 'some' ? query.gps : undefined,
    storedOn: text(query.on, 100),
    missing: query.missing === '1' ? true : undefined,
    orientation: query.orientation && ORIENTATIONS.has(query.orientation) ? (query.orientation as Orientation) : undefined,
    type: query.type && KINDS.has(query.type) ? (query.type as FileKind) : undefined,
    tier: query.tier && TIERS.has(query.tier) ? (query.tier as Tier) : undefined,
    sort: query.sort === 'added' ? 'added' : 'captured',
    limit: int(query.limit),
    offset: int(query.offset),
  }
}
