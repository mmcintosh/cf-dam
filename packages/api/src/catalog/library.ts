/**
 * Library views over the catalogue: facet counts, the timeline, map points, bulk edits and XMP
 * sidecars. Every view filters through `buildWhere`, so it agrees with the list on screen.
 */
import { escapeXml } from '../storage/xml'
import { nowIso } from '../lib/time'
import { addTags, buildWhere, KIND_SQL, ORIENTATION_SQL, softDeleteAsset, TIER_SQL, type AssetRow, type ListFilters } from './assets'
import { acceptSuggestions, queueForAi, type AcceptField } from './ai'
import { indexAsset } from './search'

export interface FacetValue {
  value: string
  count: number
}

export interface Facets {
  year: FacetValue[]
  camera: FacetValue[]
  lens: FacetValue[]
  tag: FacetValue[]
  rating: FacetValue[]
  flag: FacetValue[]
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
    db
      .prepare(
        `SELECT t.name AS value, COUNT(*) AS count FROM assets a
         JOIN asset_tags at ON at.asset_id = a.id JOIN tags t ON t.id = at.tag_id
         WHERE ${tagWhere.clause} GROUP BY t.id ORDER BY count DESC, t.name LIMIT 40`,
      )
      .bind(...tagWhere.params),
    grouped('CAST(a.rating AS TEXT)', 'rating', 6),
    grouped("COALESCE(a.flag, 'none')", 'flag', 3),
    grouped(`(${ORIENTATION_SQL})`, 'orientation', 3),
    grouped(`(${KIND_SQL})`, 'type', 4),
    grouped(TIER_SQL, 'tier', 4),
  ])
  const [year, camera, lens, tag, rating, flag, orientation, type, tier] = results.map((r) => r.results ?? [])
  return {
    year: (year ?? []).sort((a, b) => (a.value === 'undated' ? 1 : b.value === 'undated' ? -1 : b.value.localeCompare(a.value))),
    camera: camera ?? [],
    lens: lens ?? [],
    tag: tag ?? [],
    rating: (rating ?? []).sort((a, b) => b.value.localeCompare(a.value)),
    flag: flag ?? [],
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
  const live: string[] = []
  for (let i = 0; i < unique.length; i += 90) {
    const slice = unique.slice(i, i + 90)
    const { results } = await db
      .prepare(`SELECT id FROM assets WHERE deleted_at IS NULL AND id IN (${slice.map(() => '?').join(',')})`)
      .bind(...slice)
      .all<{ id: string }>()
    live.push(...results.map((r) => r.id))
  }
  if (live.length === 0) return 0
  const now = nowIso()
  const each = (sql: string, bind: (id: string) => unknown[]) => db.batch(live.map((id) => db.prepare(sql).bind(...bind(id))))

  switch (bulk.action) {
    case 'tag-add':
      for (const id of live) await addTags(db, id, bulk.tags, 'user')
      break
    case 'tag-remove': {
      const names = bulk.tags
      if (names.length === 0) break
      await each(
        `DELETE FROM asset_tags WHERE asset_id = ? AND tag_id IN (SELECT id FROM tags WHERE name IN (${names.map(() => '?').join(',')}))`,
        (id) => [id, ...names],
      )
      break
    }
    case 'rating':
      await each('UPDATE assets SET rating = ?, updated_at = ? WHERE id = ?', (id) => [bulk.rating, now, id])
      break
    case 'flag':
      await each('UPDATE assets SET flag = ?, updated_at = ? WHERE id = ?', (id) => [bulk.flag, now, id])
      break
    case 'title':
      await each('UPDATE assets SET title = ?, updated_at = ? WHERE id = ?', (id) => [bulk.title, now, id])
      break
    case 'caption':
      await each('UPDATE assets SET caption = ?, updated_at = ? WHERE id = ?', (id) => [bulk.caption, now, id])
      break
    case 'album-add': {
      const start =
        (await db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM album_items WHERE album_id = ?').bind(bulk.albumId).first<{ next: number }>())?.next ?? 0
      await db.batch([
        ...live.map((id, i) =>
          db.prepare('INSERT OR IGNORE INTO album_items (album_id, asset_id, position, added_at) VALUES (?, ?, ?, ?)').bind(bulk.albumId, id, start + i, now),
        ),
        db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').bind(now, bulk.albumId),
      ])
      break
    }
    case 'delete':
      for (const id of live) await softDeleteAsset(db, id)
      return live.length
    case 'ai-queue':
      return queueForAi(db, live)
    case 'ai-accept':
      await acceptSuggestions(db, live, bulk.fields, bulk.overwrite)
      return live.length
  }
  // Titles, captions and tags are searchable; keep the index in step.
  if (['tag-add', 'tag-remove', 'title', 'caption'].includes(bulk.action)) {
    for (const id of live) await indexAsset(db, id)
  }
  return live.length
}

const xmpDate = (captured: string | null, offset: string | null) => (captured ? `${captured}${offset ?? ''}` : null)

/**
 * An XMP sidecar with what cf-dam knows about the photo, in the Dublin Core / XMP / Lightroom fields
 * that Lightroom, Capture One, Photo Mechanic and Bridge read. Keeps the metadata portable.
 */
export function xmpSidecar(asset: AssetRow, tags: string[]): string {
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
    `    xmp:MetadataDate="${nowIso()}"`,
    asset.rating !== null ? `    xmp:Rating="${asset.flag === 'reject' ? -1 : asset.rating}"` : asset.flag === 'reject' ? '    xmp:Rating="-1"' : '',
    asset.flag === 'pick' ? '    xmp:Label="Pick"' : '',
    xmpDate(asset.captured_at, asset.captured_offset) ? `    photoshop:DateCreated="${xmpDate(asset.captured_at, asset.captured_offset)}"` : '',
    '  >',
    asset.title ? `   <dc:title>${alt(asset.title)}</dc:title>` : '',
    asset.caption ? `   <dc:description>${alt(asset.caption)}</dc:description>` : '',
    asset.alt ? `   <Iptc4xmpCore:AltTextAccessibility>${alt(asset.alt)}</Iptc4xmpCore:AltTextAccessibility>` : '',
    tags.length > 0 ? `   <dc:subject><rdf:Bag>${tags.map((t) => `<rdf:li>${escapeXml(t)}</rdf:li>`).join('')}</rdf:Bag></dc:subject>` : '',
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
