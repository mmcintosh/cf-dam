/**
 * Library views over the catalogue: facet counts, the timeline, map points, bulk edits and XMP
 * sidecars. Every view filters through `buildWhere`, so it agrees with the list on screen.
 */
import { escapeXml } from '../storage/xml'
import { nowIso } from '../lib/time'
import { addTags, buildWhere, isLabel, KIND_SQL, LABELS, ORIENTATION_SQL, softDeleteAssets, TIER_SQL, type AssetRow, type Label, type ListFilters } from './assets'
import { getPreset, iptcXmp, presetStatements } from './iptc'
import { displayPath, matchKeywords, SUBTREE } from './keywords'
import { acceptSuggestions, queueForAi, type AcceptField } from './ai'
import { indexAssets } from './search'

export interface FacetValue {
  value: string
  count: number
}

/** A keyword in the facet tree. `count` includes photos tagged anywhere below it. */
export interface KeywordFacet {
  id: string
  parentId: string | null
  name: string
  path: string
  count: number
}

export interface Facets {
  year: FacetValue[]
  camera: FacetValue[]
  lens: FacetValue[]
  tag: KeywordFacet[]
  rating: FacetValue[]
  flag: FacetValue[]
  label: FacetValue[]
  country: FacetValue[]
  city: FacetValue[]
  creator: FacetValue[]
  orientation: FacetValue[]
  type: FacetValue[]
  tier: FacetValue[]
}

/** Each facet's counts ignore that facet's own selection, so you can switch between its values. */
export async function facets(db: D1Database, filters: ListFilters): Promise<Facets> {
  const grouped = (expr: string, omit: keyof ListFilters, limit = 30) => {
    const { clause, params } = buildWhere(filters, omit)
    return db
      .prepare(`SELECT ${expr} AS value, COUNT(*) AS count FROM assets a WHERE ${clause} AND ${expr} IS NOT NULL GROUP BY value ORDER BY count DESC, value LIMIT ?`)
      .bind(...params, limit)
  }
  const tagWhere = buildWhere(filters, 'tag')
  const results = await db.batch<FacetValue>([
    grouped("COALESCE(substr(a.captured_at, 1, 4), 'undated')", 'year', 100),
    grouped('a.camera_model', 'camera'),
    grouped('a.lens', 'lens'),
    // Counts roll up: a photo tagged Bergen counts towards Norway, Europe and Places too.
    db
      .prepare(
        `${SUBTREE('SELECT id FROM tags')}
         SELECT f.id, f.parent_id AS parentId, f.name, f.full_path AS path, COUNT(DISTINCT a.id) AS count
         FROM assets a JOIN asset_tags at ON at.asset_id = a.id JOIN under ON under.id = at.tag_id JOIN tags f ON f.id = under.root
         WHERE ${tagWhere.clause} GROUP BY f.id ORDER BY f.path LIMIT 1000`,
      )
      .bind(...tagWhere.params),
    grouped('CAST(a.rating AS TEXT)', 'rating', 6),
    grouped("COALESCE(a.flag, 'none')", 'flag', 3),
    grouped('a.label', 'label', 5),
    grouped('a.country', 'country', 40),
    grouped('a.city', 'city', 40),
    grouped('a.creator', 'creator', 20),
    grouped(`(${ORIENTATION_SQL})`, 'orientation', 3),
    grouped(`(${KIND_SQL})`, 'type', 4),
    grouped(TIER_SQL, 'tier', 4),
  ])
  const [year, camera, lens, tag, rating, flag, label, country, city, creator, orientation, type, tier] = results.map((r) => r.results ?? [])
  return {
    year: (year ?? []).sort((a, b) => (a.value === 'undated' ? 1 : b.value === 'undated' ? -1 : b.value.localeCompare(a.value))),
    camera: camera ?? [],
    lens: lens ?? [],
    tag: ((tag ?? []) as unknown as KeywordFacet[]).map((k) => ({ ...k, path: displayPath(k.path) })),
    rating: (rating ?? []).sort((a, b) => b.value.localeCompare(a.value)),
    flag: flag ?? [],
    label: (label ?? []).sort((a, b) => LABELS.indexOf(a.value as Label) - LABELS.indexOf(b.value as Label)),
    country: country ?? [],
    city: city ?? [],
    creator: creator ?? [],
    orientation: orientation ?? [],
    type: type ?? [],
    tier: tier ?? [],
  }
}

/** Photos per month, for the timeline. */
export async function timeline(db: D1Database, filters: ListFilters): Promise<{ month: string; count: number }[]> {
  const { clause, params } = buildWhere(filters, 'year')
  const { results } = await db
    .prepare(
      `SELECT substr(a.captured_at, 1, 7) AS month, COUNT(*) AS count FROM assets a
       WHERE ${clause} AND a.captured_at IS NOT NULL GROUP BY month ORDER BY month`,
    )
    .bind(...params)
    .all<{ month: string; count: number }>()
  return results
}

export async function geoPoints(db: D1Database, filters: ListFilters, limit = 5000): Promise<{ id: string; lat: number; lng: number }[]> {
  const { clause, params } = buildWhere(filters)
  const { results } = await db
    .prepare(`SELECT a.id, a.gps_lat AS lat, a.gps_lng AS lng FROM assets a WHERE ${clause} AND a.gps_lat IS NOT NULL AND a.gps_lng IS NOT NULL LIMIT ?`)
    .bind(...params, limit)
    .all<{ id: string; lat: number; lng: number }>()
  return results
}

export type BulkAction =
  | { action: 'tag-add'; tags: string[] }
  | { action: 'tag-remove'; tags: string[] }
  | { action: 'rating'; rating: number | null }
  | { action: 'flag'; flag: 'pick' | 'reject' | null }
  | { action: 'label'; label: Label | null }
  | { action: 'preset'; presetId: string; overwrite: boolean }
  | { action: 'gps'; lat: number | null; lng: number | null }
  | { action: 'title'; title: string | null }
  | { action: 'caption'; caption: string | null }
  | { action: 'album-add'; albumId: string }
  | { action: 'delete' }
  | { action: 'ai-queue' }
  | { action: 'ai-accept'; fields: AcceptField[]; overwrite: boolean }

/** The permission each bulk action needs. */
export const BULK_PERMISSION: Record<BulkAction['action'], string> = {
  'tag-add': 'assets:edit',
  'tag-remove': 'assets:edit',
  rating: 'assets:edit',
  flag: 'assets:edit',
  label: 'assets:edit',
  preset: 'assets:edit',
  gps: 'assets:edit',
  title: 'assets:edit',
  caption: 'assets:edit',
  'album-add': 'assets:edit',
  delete: 'assets:delete',
  'ai-queue': 'ai:run',
  'ai-accept': 'assets:edit',
}

export const MAX_BULK = 500

/** Apply one action to many assets. Returns how many existed (deleted ones are skipped). */
export async function applyBulk(db: D1Database, ids: string[], bulk: BulkAction): Promise<number> {
  const unique = [...new Set(ids)].slice(0, MAX_BULK)
  const { results } = await db
    .prepare('SELECT id FROM assets WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(unique))
    .all<{ id: string }>()
  const live = results.map((r) => r.id)
  if (live.length === 0) return 0
  const now = nowIso()
  const list = JSON.stringify(live)
  // One statement for all of them: `sql` sets columns, then the ids are bound after `values`.
  const each = (sql: string, values: unknown[]) => db.prepare(`${sql} WHERE id IN (SELECT value FROM json_each(?))`).bind(...values, list).run()

  switch (bulk.action) {
    case 'tag-add':
      await addTags(db, live, bulk.tags, 'user')
      break
    case 'tag-remove': {
      const ids = await matchKeywords(db, bulk.tags)
      if (ids.length === 0) break
      // As JSON lists: any number of photos and keywords in one statement (D1 binds at most 100 values).
      await db
        .prepare('DELETE FROM asset_tags WHERE asset_id IN (SELECT value FROM json_each(?)) AND tag_id IN (SELECT value FROM json_each(?))')
        .bind(list, JSON.stringify(ids))
        .run()
      break
    }
    case 'rating':
      await each('UPDATE assets SET rating = ?, updated_at = ?', [bulk.rating, now])
      break
    case 'flag':
      await each('UPDATE assets SET flag = ?, updated_at = ?', [bulk.flag, now])
      break
    case 'label':
      await each('UPDATE assets SET label = ?, updated_at = ?', [bulk.label, now])
      break
    case 'preset': {
      const preset = await getPreset(db, bulk.presetId)
      if (!preset) return 0
      const statements = presetStatements(db, preset, live, bulk.overwrite)
      if (statements.length > 0) await db.batch(statements)
      break
    }
    case 'gps':
      // Places filled in from the old position go with it; the caller looks the new one up.
      await each(
        `UPDATE assets SET gps_lat = ?, gps_lng = ?, place_checked_at = NULL, updated_at = ?,
           city = CASE WHEN location_source = 'gps' THEN NULL ELSE city END,
           state = CASE WHEN location_source = 'gps' THEN NULL ELSE state END,
           country = CASE WHEN location_source = 'gps' THEN NULL ELSE country END,
           country_code = CASE WHEN location_source = 'gps' THEN NULL ELSE country_code END,
           location_source = CASE WHEN location_source = 'gps' THEN NULL ELSE location_source END`,
        [bulk.lat, bulk.lng, now],
      )
      break
    case 'title':
      await each('UPDATE assets SET title = ?, updated_at = ?', [bulk.title, now])
      break
    case 'caption':
      await each('UPDATE assets SET caption = ?, updated_at = ?', [bulk.caption, now])
      break
    case 'album-add': {
      const start =
        (await db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM album_items WHERE album_id = ?').bind(bulk.albumId).first<{ next: number }>())?.next ?? 0
      await db.batch([
        db
          .prepare('INSERT OR IGNORE INTO album_items (album_id, asset_id, position, added_at) SELECT ?, value, ? + key, ? FROM json_each(?)')
          .bind(bulk.albumId, start, now, list),
        db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').bind(now, bulk.albumId),
      ])
      break
    }
    case 'delete':
      await softDeleteAssets(db, live)
      return live.length
    case 'ai-queue':
      return queueForAi(db, live)
    case 'ai-accept':
      await acceptSuggestions(db, live, bulk.fields, bulk.overwrite)
      return live.length
  }
  // Titles, captions and tags are searchable; keep the index in step. (After a GPS change the caller
  // looks the new places up, then reindexes.)
  if (['tag-add', 'tag-remove', 'title', 'caption', 'preset'].includes(bulk.action)) await indexAssets(db, live)
  return live.length
}

const xmpDate = (captured: string | null, offset: string | null) => (captured ? `${captured}${offset ?? ''}` : null)

/**
 * An XMP sidecar with what cf-dam knows about the photo, in the Dublin Core / XMP / Lightroom fields
 * that Lightroom, Capture One, Photo Mechanic and Bridge read. Keeps the metadata portable.
 */
export type LabelNames = Record<Label, string>

const DEFAULT_LABEL_NAMES: LabelNames = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' }

/** What each colour label is called in this archive (Lightroom writes the name, not the colour). */
export async function getLabelNames(db: D1Database): Promise<LabelNames> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'labels.names'").first<{ value: string }>()
  const names = { ...DEFAULT_LABEL_NAMES }
  try {
    const parsed = JSON.parse(row?.value ?? '{}') as Record<string, unknown>
    for (const label of LABELS) if (typeof parsed[label] === 'string' && parsed[label]) names[label] = (parsed[label] as string).slice(0, 40)
  } catch {
    // defaults
  }
  return names
}

export async function saveLabelNames(db: D1Database, patch: Partial<LabelNames>): Promise<LabelNames> {
  const names = { ...(await getLabelNames(db)) }
  for (const label of LABELS) {
    const value = patch[label]
    if (typeof value === 'string' && value.trim()) names[label] = value.trim().slice(0, 40)
  }
  await db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('labels.names', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(JSON.stringify(names), nowIso())
    .run()
  return names
}

export function xmpSidecar(asset: AssetRow, keywords: { subjects: string[]; hierarchical: string[] }, labelNames: LabelNames = DEFAULT_LABEL_NAMES): string {
  const iptc = iptcXmp(asset as unknown as Record<string, unknown>)
  const alt = (value: string) => `<rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(value)}</rdf:li></rdf:Alt>`
  const lines = [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="cf-dam">',
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '  <rdf:Description rdf:about=""',
    '    xmlns:dc="http://purl.org/dc/elements/1.1/"',
    '    xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    '    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"',
    '    xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"',
    '    xmlns:lr="http://ns.adobe.com/lightroom/1.0/"',
    '    xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"',
    `    xmp:MetadataDate="${nowIso()}"`,
    asset.rating !== null ? `    xmp:Rating="${asset.flag === 'reject' ? -1 : asset.rating}"` : asset.flag === 'reject' ? '    xmp:Rating="-1"' : '',
    isLabel(asset.label) ? `    xmp:Label="${escapeXml(labelNames[asset.label])}"` : '',
    xmpDate(asset.captured_at, asset.captured_offset) ? `    photoshop:DateCreated="${xmpDate(asset.captured_at, asset.captured_offset)}"` : '',
    ...iptc.attributes,
    '  >',
    ...iptc.elements,
    asset.title ? `   <dc:title>${alt(asset.title)}</dc:title>` : '',
    asset.caption ? `   <dc:description>${alt(asset.caption)}</dc:description>` : '',
    asset.alt ? `   <Iptc4xmpCore:AltTextAccessibility>${alt(asset.alt)}</Iptc4xmpCore:AltTextAccessibility>` : '',
    keywords.subjects.length > 0 ? `   <dc:subject><rdf:Bag>${keywords.subjects.map((t) => `<rdf:li>${escapeXml(t)}</rdf:li>`).join('')}</rdf:Bag></dc:subject>` : '',
    keywords.hierarchical.length > 0
      ? `   <lr:hierarchicalSubject><rdf:Bag>${keywords.hierarchical.map((t) => `<rdf:li>${escapeXml(t)}</rdf:li>`).join('')}</rdf:Bag></lr:hierarchicalSubject>`
      : '',
    '  </rdf:Description>',
    ' </rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ]
  return lines.filter((line) => line !== '').join('\n') + '\n'
}

/** `IMG_2041.CR3` → `IMG_2041.xmp`, the name Lightroom pairs with the original. */
export function sidecarName(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return `${dot > 0 ? filename.slice(0, dot) : filename}.xmp`
}
