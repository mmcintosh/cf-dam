/** Asset records, their locations, tags and the list query. */
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { ARCHIVE_CLASSES } from '../storage/types'
import { editedSize, imageVersion, readEdit, type ImageEdit } from './edits'
import { GPS_PLACE_BITS, iptcJson, iptcUpdate, type IptcKey, type IptcValues } from './iptc'
import { displayPath, keywordFilterSql, keywordIdFilterSql, resolveKeywords } from './keywords'
import { indexAsset, SEARCH_MATCH, toFtsQuery } from './search'

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
  /** The quick fingerprint (size, first and last MiB): a helper's, or an upload's since 0036. */
  quick_hash: string | null
  edit?: string | null
  edited_at?: string | null
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
  ai_language: string | null
  ai_text: string | null
  facet_status?: string | null
  facet_error?: string | null
  facet_people?: string | null
  facet_people_jev?: string | null
  facet_people_by?: string | null
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
  place_gps: number
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

/** The locations of many assets, in one query. */
export async function locationsOf(db: D1Database, assetIds: string[]): Promise<Map<string, LocationRow[]>> {
  const map = new Map<string, LocationRow[]>()
  if (assetIds.length === 0) return map
  const { results } = await db
    .prepare('SELECT * FROM asset_locations WHERE asset_id IN (SELECT value FROM json_each(?)) ORDER BY connection_id')
    .bind(JSON.stringify(assetIds))
    .all<LocationRow>()
  for (const row of results) map.set(row.asset_id, [...(map.get(row.asset_id) ?? []), row])
  return map
}

/**
 * Whether this copy of an original can be read now: there, and either in a warm class (R2, a NAS, S3 Standard…)
 * or restored from a cold class and not yet expired. Coldness is the class, not the state: the agent archive
 * records its Deep Archive copies as 'present'.
 */
export function readableNow(location: Pick<LocationRow, 'state' | 'storage_class' | 'restore_expires_at'>, now = nowIso()): boolean {
  if (location.state === 'pending' || location.state === 'gone') return false
  if (!ARCHIVE_CLASSES.has(location.storage_class)) return true
  return location.state === 'restored' && location.restore_expires_at !== null && location.restore_expires_at > now
}

/** Where the original can be read from for a client: never a NAS, never deep storage that isn't restored. */
export function reachableForClient(locations: LocationRow[], nas: Set<string>): LocationRow | null {
  const usable = locations.filter((l) => !nas.has(l.connection_id) && readableNow(l))
  return usable.find((l) => l.connection_id === 'r2') ?? usable[0] ?? null
}

/** The location to read the original from: the built-in R2 first, then any copy readable now, then any there. */
export function primaryLocation(locations: LocationRow[]): LocationRow | null {
  const usable = locations.filter((l) => l.state !== 'pending' && l.state !== 'gone')
  return usable.find((l) => l.connection_id === 'r2') ?? usable.find((l) => readableNow(l)) ?? usable[0] ?? null
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
  return [...new Set((await resolveKeywords(db, [...new Set(names)].slice(0, 200))).values())]
}

/**
 * Add keywords by name or path (`Places > Norway > Oslo`), creating them as needed. `source` records
 * where a tag came from: user, import, ai, lightroom.
 */
export async function addTags(db: D1Database, assetIds: string | string[], names: string[], source: TagSource): Promise<void> {
  const ids = await resolveAll(db, names)
  const pairs = [assetIds].flat().flatMap((assetId) => ids.map((id) => [assetId, id] as const))
  if (pairs.length > 0) await tagStatement(db, pairs, source).run()
}

export type TagSource = 'user' | 'import' | 'ai' | 'lightroom'

/** One statement that tags any number of (asset, keyword) pairs; pairs already there are left as they are. */
export const tagStatement = (db: D1Database, pairs: (readonly [string, string])[], source: TagSource) =>
  db
    .prepare(
      `INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, source, created_at)
       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), ?, ? FROM json_each(?)`,
    )
    .bind(source, nowIso(), JSON.stringify(pairs))

/**
 * Replace an asset's own tags with exactly `names`. AI suggestions are kept apart (they are accepted
 * or removed on their own), except that naming one here makes it the person's own.
 */
export async function setTags(db: D1Database, assetId: string, names: string[]): Promise<void> {
  const ids = await resolveAll(db, names)
  const now = nowIso()
  await db.batch([
    db.prepare("DELETE FROM asset_tags WHERE asset_id = ? AND source != 'ai'").bind(assetId),
    db
      .prepare(
        `INSERT INTO asset_tags (asset_id, tag_id, source, created_at) SELECT ?, value, 'user', ? FROM json_each(?) WHERE true
         ON CONFLICT (asset_id, tag_id) DO UPDATE SET source = 'user'`,
      )
      .bind(assetId, now, JSON.stringify(ids)),
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
  /** Rotate, mirror and crop shown in place of the original's own framing (edits.ts); null when none. */
  edit: ImageEdit | null
  /** The size of the picture people see: the original's, or the edited one's. */
  displayWidth: number | null
  displayHeight: number | null
  /** Add to thumbnail and preview addresses (`?v=`): it changes with every edit. */
  imageVersion: string
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
    /** What the suggestions are written in (a language code); null for reviews from before, all English. */
    language: string | null
    error: string | null
  }
  /**
   * People in the photo, from TypeSafe's Jev (jev-facets.ts) or set by hand: what the Library's People filter uses
   * (`value`), Jev's own answer (`jev`), whether a person set it (`byHand`), and how far asking has got.
   */
  people: { value: string | null; jev: string | null; byHand: boolean; status: string | null; error: string | null }
  /** IPTC Core: credit, rights, contact, place, job. */
  iptc: Record<IptcKey, string | null>
  /** The place fields filled in from GPS (the rest of the place, if any, came from the file or a person). */
  placeFromGps: IptcKey[]
  /** Videos: length in seconds, codec, frames per second. Null for photos. */
  video: { duration: number | null; codec: string | null; frameRate: number | null } | null
  createdAt: string
  updatedAt: string
}

export function assetJson(row: AssetRow, renditions: string[], location: LocationRow | null = null): AssetJson {
  const edit = readEdit(row.edit)
  const display = row.width && row.height ? editedSize(row.width, row.height, edit) : null
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
    edit,
    displayWidth: display?.width ?? row.width,
    displayHeight: display?.height ?? row.height,
    imageVersion: imageVersion(row.edited_at),
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
      language: row.ai_language ?? null,
      error: row.ai_error ?? null,
    },
    people: {
      value: row.facet_people ?? null,
      jev: row.facet_people_jev ?? null,
      byHand: !!row.facet_people_by,
      status: row.facet_status ?? null,
      error: row.facet_error ?? null,
    },
    iptc: iptcJson(row as unknown as Record<string, unknown>),
    placeFromGps: (Object.entries(GPS_PLACE_BITS) as [IptcKey, number][]).filter(([, bit]) => row.place_gps & bit).map(([key]) => key),
    video: row.mime_type.startsWith('video/') ? { duration: row.duration ?? null, codec: row.video_codec ?? null, frameRate: row.frame_rate ?? null } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function renditionNames(db: D1Database, assetIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (assetIds.length === 0) return map
  const { results } = await db
    .prepare('SELECT asset_id, name FROM renditions WHERE asset_id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(assetIds))
    .all<{ asset_id: string; name: string }>()
  for (const row of results) map.set(row.asset_id, [...(map.get(row.asset_id) ?? []), row.name])
  return map
}

export interface ListFilters {
  q?: string
  /** Search by meaning (catalog/meaning.ts): words, or a photo whose kind is wanted. */
  meaning?: string
  like?: string
  /** What `meaning` or `like` found, nearest first (resolveNear). Unresolved, they match nothing. */
  near?: string[]
  /** Keywords as typed: a path ('Places > Norway'), or a name meaning every keyword of that name. */
  tag?: string
  /** One keyword by id, and those below it (`kw=`: facet links, saved searches). Part of the tag facet. */
  keyword?: string
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
  /** From the library facets (jev-facets.ts): 'yes' is any number of people, 'no' none, or one count. */
  people?: PeopleFilter
  /** People named by hand or from the file (catalog/people.ts): photos with all of them. */
  person?: number[]
  /** A group of people (catalog/gallery-people.ts): photos with anyone in it. */
  group?: number
  /** With `group`: only photos where everyone named is in the group (and someone is). */
  groupOnly?: boolean
  type?: FileKind
  tier?: Tier
  sort?: 'captured' | 'added'
  limit?: number
  offset?: number
}

export type Orientation = 'landscape' | 'portrait' | 'square'
export const PEOPLE_FILTERS = ['yes', 'no', 'one', 'two_to_five', 'six_or_more', 'some'] as const
export type PeopleFilter = (typeof PEOPLE_FILTERS)[number]
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
/**
 * What makes two photos the same file: the quick fingerprint, which every helper photo and every
 * upload since 0036 has, else (older uploads) the SHA-256. idx_assets_live_content is on exactly this.
 */
export const CONTENT_KEY = 'COALESCE(quick_hash, sha256)'
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
  if (filters.near !== undefined) {
    where.push('a.id IN (SELECT value FROM json_each(?))')
    params.push(JSON.stringify(filters.near))
  } else if (filters.meaning || filters.like) {
    // Never everything: a search by meaning nobody looked up (a bulk action, a saved search) finds nothing.
    where.push('0')
  }
  const fts = use('q') ? toFtsQuery(filters.q!) : null
  if (fts) {
    where.push(SEARCH_MATCH)
    params.push(fts)
  }
  if (use('tag')) {
    const { sql, params: tagParams } = keywordFilterSql(filters.tag!)
    where.push(sql)
    params.push(...tagParams)
  }
  if (use('keyword') && omit !== 'tag') {
    const { sql, params: tagParams } = keywordIdFilterSql(filters.keyword!)
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
    // A plain day includes the whole day: before the next one starts.
    const day = /^\d{4}-\d{2}-\d{2}$/.test(filters.to!) ? filters.to! : null
    where.push(day ? 'a.captured_at < date(?, \'+1 day\')' : 'a.captured_at <= ?')
    params.push(filters.to)
  }
  // Years and months as ranges of captured_at, so its index answers them.
  if (use('year')) {
    if (filters.year === 'undated') where.push('a.captured_at IS NULL')
    else {
      where.push('a.captured_at >= ? AND a.captured_at < ?')
      params.push(filters.year, String(Number(filters.year) + 1))
    }
  }
  if (use('month')) {
    const [y, m] = filters.month!.split('-').map(Number) as [number, number]
    where.push('a.captured_at >= ? AND a.captured_at < ?')
    params.push(filters.month, m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`)
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
  // Location filters look up each photo's own locations (by the (asset_id, connection_id) key): an
  // IN list would be built from millions of locations first.
  if (use('storedOn')) {
    where.push(`EXISTS (SELECT 1 FROM asset_locations l WHERE l.asset_id = a.id AND l.connection_id = ? AND l.state != 'gone')`)
    params.push(filters.storedOn)
  }
  if (filters.missing && omit !== 'missing') where.push(`EXISTS (SELECT 1 FROM asset_locations l WHERE l.asset_id = a.id AND l.state = 'missing')`)
  if (use('gps')) where.push(filters.gps === 'none' ? 'a.gps_lat IS NULL' : 'a.gps_lat IS NOT NULL')
  if (use('label')) {
    where.push(filters.label === 'none' ? 'a.label IS NULL' : 'a.label = ?')
    if (filters.label !== 'none') params.push(filters.label)
  }
  if (use('orientation')) {
    where.push(`(${ORIENTATION_SQL}) = ?`)
    params.push(filters.orientation)
  }
  if (use('people')) {
    if (filters.people === 'yes') where.push("a.facet_people IS NOT NULL AND a.facet_people != 'none'")
    else {
      where.push('a.facet_people = ?')
      params.push(filters.people === 'no' ? 'none' : filters.people)
    }
  }
  if (use('person') && filters.person!.length > 0) {
    for (const id of filters.person!) {
      where.push('EXISTS (SELECT 1 FROM asset_people ap WHERE ap.asset_id = a.id AND ap.person_id = ?)')
      params.push(id)
    }
  }
  if (use('group')) {
    where.push('EXISTS (SELECT 1 FROM asset_people ap JOIN people_group_members gm ON gm.person_id = ap.person_id WHERE ap.asset_id = a.id AND gm.group_id = ?)')
    params.push(filters.group)
    // The team's "only them": counts only people named on the photo, as the filter's label says.
    if (filters.groupOnly) {
      where.push('NOT EXISTS (SELECT 1 FROM asset_people ap WHERE ap.asset_id = a.id AND ap.person_id NOT IN (SELECT gm.person_id FROM people_group_members gm WHERE gm.group_id = ?))')
      params.push(filters.group)
    }
  }
  if (use('type')) {
    where.push(`(${KIND_SQL}) = ?`)
    params.push(filters.type)
  }
  if (use('tier')) {
    const classes = TIER_CLASSES[filters.tier!] ?? []
    // With a connection chosen too (Stored on), the tier is that connection's copy: a job archived to Deep Archive
    // keeps its R2 copy, and "on the S3 bucket, hot" shouldn't find it by the R2 one.
    const onConnection = use('storedOn') ? ' AND l.connection_id = ?' : ''
    where.push(
      `EXISTS (SELECT 1 FROM asset_locations l WHERE l.asset_id = a.id AND l.state NOT IN ('pending', 'gone') AND l.storage_class IN (${classes.map(() => '?').join(',')})${onConnection})`,
    )
    params.push(...classes)
    if (onConnection) params.push(filters.storedOn)
  }
  return { clause: where.join(' AND '), params }
}

/**
 * Counts stop here: past it a count reads the whole catalog (1.4 million rows for the first
 * photographer) to say a number nobody pages through. Shown as "10,000+".
 */
export const COUNT_CAP = 10_000

/** `COUNT(*)` of the photos matching `clause`, stopping at COUNT_CAP + 1. */
export const cappedCount = (clause: string) => `SELECT COUNT(*) AS n FROM (SELECT 1 FROM assets a WHERE ${clause} LIMIT ${COUNT_CAP + 1})`

/**
 * One page of photos, and how many match: `total` is exact unless `totalExact` is false, when at least
 * that many match (COUNT_CAP).
 */
export async function listAssets(db: D1Database, filters: ListFilters): Promise<{ assets: AssetJson[]; total: number; totalExact: boolean }> {
  const { clause, params } = buildWhere(filters)
  // A search by meaning lists the nearest first.
  const order = filters.near
    ? '(SELECT j.key FROM json_each(?) j WHERE j.value = a.id)'
    : filters.sort === 'added'
      ? 'a.created_at DESC, a.id DESC'
      : 'COALESCE(a.captured_at, a.created_at) DESC, a.id DESC'
  const limit = Math.min(Math.max(filters.limit ?? 60, 1), 200)
  const offset = Math.max(filters.offset ?? 0, 0)

  const [rows, count] = await db.batch([
    db.prepare(`SELECT a.* FROM assets a WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...params, ...(filters.near ? [JSON.stringify(filters.near)] : []), limit, offset),
    db.prepare(cappedCount(clause)).bind(...params),
  ])
  const assets = (rows!.results ?? []) as AssetRow[]
  const n = (count!.results?.[0] as { n: number } | undefined)?.n ?? 0
  const ids = assets.map((a) => a.id)
  const renditions = await renditionNames(db, ids)
  const locations = await locationsOf(db, ids)
  return {
    assets: assets.map((row) => assetJson(row, renditions.get(row.id) ?? [], primaryLocation(locations.get(row.id) ?? []))),
    total: Math.min(n, COUNT_CAP),
    totalExact: n <= COUNT_CAP,
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
  const iptc = patch.iptc ? iptcUpdate(db, id, patch.iptc) : null
  if (iptc) await iptc.run()
  if (patch.tags !== undefined) await setTags(db, id, patch.tags)
  await indexAsset(db, id)
}

export async function softDeleteAssets(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const list = JSON.stringify(ids)
  await db.batch([
    db.prepare('UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL').bind(nowIso(), nowIso(), list),
    db.prepare('DELETE FROM search_index WHERE rowid IN (SELECT search_id FROM assets WHERE id IN (SELECT value FROM json_each(?)))').bind(list),
  ])
}

export const softDeleteAsset = (db: D1Database, id: string) => softDeleteAssets(db, [id])

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
    meaning: text(query.meaning, 500),
    like: query.like && /^[0-9a-f]{32}$/.test(query.like) ? query.like : undefined,
    tag: text(query.tag),
    keyword: text(query.kw, 64),
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
    people: (PEOPLE_FILTERS as readonly string[]).includes(query.people ?? '') ? (query.people as PeopleFilter) : undefined,
    person: query.person && /^\d{1,12}(,\d{1,12}){0,4}$/.test(query.person) ? [...new Set(query.person.split(',').map(Number))] : undefined,
    group: query.group && /^\d{1,12}$/.test(query.group) ? Number(query.group) : undefined,
    groupOnly: query.group && query.only === '1' ? true : undefined,
    type: query.type && KINDS.has(query.type) ? (query.type as FileKind) : undefined,
    tier: query.tier && TIERS.has(query.tier) ? (query.tier as Tier) : undefined,
    sort: query.sort === 'added' ? 'added' : 'captured',
    limit: int(query.limit),
    offset: int(query.offset),
  }
}
