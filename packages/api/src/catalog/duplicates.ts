/**
 * Duplicates: exact copies (same SHA-256) and look-alikes (perceptual hashes within a few bits).
 * Resolving a group keeps one asset and soft-deletes the rest, after folding their tags, albums,
 * best rating and any pick into the one kept, so nothing anyone added is lost.
 */
import { nowIso } from '../lib/time'
import { assetJson, getLocations, primaryLocation, renditionNames, softDeleteAsset, type AssetJson, type AssetRow } from './assets'
import { indexAsset } from './search'

export interface DuplicateGroup {
  key: string
  kind: 'exact' | 'similar'
  /** Members, best first: the one cf-dam suggests keeping. */
  assets: (AssetJson & { albums: number; tags: number })[]
}

async function withDetails(db: D1Database, rows: AssetRow[]) {
  const ids = rows.map((r) => r.id)
  const renditions = await renditionNames(db, ids)
  const counts = new Map<string, { albums: number; tags: number }>()
  if (ids.length > 0) {
    const marks = ids.map(() => '?').join(',')
    const [albums, tags] = await db.batch<{ id: string; n: number }>([
      db.prepare(`SELECT asset_id AS id, COUNT(*) AS n FROM album_items WHERE asset_id IN (${marks}) GROUP BY asset_id`).bind(...ids),
      db.prepare(`SELECT asset_id AS id, COUNT(*) AS n FROM asset_tags WHERE asset_id IN (${marks}) GROUP BY asset_id`).bind(...ids),
    ])
    for (const id of ids) counts.set(id, { albums: 0, tags: 0 })
    for (const r of albums!.results) counts.get(r.id)!.albums = r.n
    for (const r of tags!.results) counts.get(r.id)!.tags = r.n
  }
  const out = []
  for (const row of rows) {
    const location = primaryLocation(await getLocations(db, row.id))
    out.push({ ...assetJson(row, renditions.get(row.id) ?? [], location), ...(counts.get(row.id) ?? { albums: 0, tags: 0 }) })
  }
  // Best first: most pixels, then a pick, then the higher rating, then the earliest upload.
  return out.sort(
    (x, y) =>
      (y.width ?? 0) * (y.height ?? 0) - (x.width ?? 0) * (x.height ?? 0) ||
      Number(y.flag === 'pick') - Number(x.flag === 'pick') ||
      (y.rating ?? 0) - (x.rating ?? 0) ||
      x.createdAt.localeCompare(y.createdAt),
  )
}

export async function exactGroups(db: D1Database, limit = 50): Promise<{ groups: DuplicateGroup[]; total: number }> {
  const [hashes, total] = await db.batch([
    db
      .prepare(
        `SELECT sha256 FROM assets WHERE deleted_at IS NULL AND sha256 IS NOT NULL
         GROUP BY sha256 HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC, MIN(created_at) LIMIT ?`,
      )
      .bind(limit),
    db.prepare(
      `SELECT COUNT(*) AS n FROM (SELECT sha256 FROM assets WHERE deleted_at IS NULL AND sha256 IS NOT NULL GROUP BY sha256 HAVING COUNT(*) > 1)`,
    ),
  ])
  const groups: DuplicateGroup[] = []
  for (const { sha256 } of hashes!.results as { sha256: string }[]) {
    const { results } = await db.prepare('SELECT * FROM assets WHERE sha256 = ? AND deleted_at IS NULL').bind(sha256).all<AssetRow>()
    groups.push({ key: sha256, kind: 'exact', assets: await withDetails(db, results) })
  }
  return { groups, total: ((total!.results[0] as { n: number } | undefined)?.n) ?? 0 }
}

/** Look-alike groups from undismissed pairs (exact copies are left to the exact tab). */
export async function similarGroups(db: D1Database, limit = 50): Promise<{ groups: DuplicateGroup[]; total: number }> {
  const { results: pairs } = await db
    .prepare(
      `SELECT p.a, p.b FROM similar_pairs p
       JOIN assets x ON x.id = p.a AND x.deleted_at IS NULL
       JOIN assets y ON y.id = p.b AND y.deleted_at IS NULL
       WHERE p.dismissed = 0 AND NOT (x.sha256 IS NOT NULL AND x.sha256 = y.sha256)
       LIMIT 20000`,
    )
    .all<{ a: string; b: string }>()

  // Star grouping, not chains: a group is a photo plus the photos directly similar to it, so every
  // member resembles the centre. (Connected components would glue A~B and B~C into one group even
  // when A and C look nothing alike.) Centres with the most look-alikes go first.
  const neighbours = new Map<string, Set<string>>()
  for (const { a, b } of pairs) {
    if (!neighbours.has(a)) neighbours.set(a, new Set())
    if (!neighbours.has(b)) neighbours.set(b, new Set())
    neighbours.get(a)!.add(b)
    neighbours.get(b)!.add(a)
  }
  const assigned = new Set<string>()
  const sorted: string[][] = []
  for (const centre of [...neighbours.keys()].sort((x, y) => neighbours.get(y)!.size - neighbours.get(x)!.size || x.localeCompare(y))) {
    if (assigned.has(centre)) continue
    const members = [centre, ...[...neighbours.get(centre)!].filter((id) => !assigned.has(id))]
    if (members.length < 2) continue
    for (const id of members) assigned.add(id)
    sorted.push(members)
  }

  const groups: DuplicateGroup[] = []
  for (const ids of sorted.slice(0, limit)) {
    const { results } = await db
      .prepare(`SELECT * FROM assets WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids)
      .all<AssetRow>()
    if (results.length > 1) groups.push({ key: [...ids].sort()[0]!, kind: 'similar', assets: await withDetails(db, results) })
  }
  return { groups, total: sorted.length }
}

/** Keep one asset, fold the others' metadata into it, then soft-delete them. */
export async function keepOne(db: D1Database, keep: string, remove: string[]): Promise<number> {
  const others = remove.filter((id) => id !== keep)
  if (others.length === 0) return 0
  const marks = others.map(() => '?').join(',')
  const now = nowIso()
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, source, created_at) SELECT ?, tag_id, source, ? FROM asset_tags WHERE asset_id IN (${marks})`).bind(keep, now, ...others),
    db.prepare(`INSERT OR IGNORE INTO album_items (album_id, asset_id, position, added_at) SELECT album_id, ?, position, ? FROM album_items WHERE asset_id IN (${marks})`).bind(keep, now, ...others),
    db
      .prepare(
        `UPDATE assets SET
           rating = MAX(COALESCE(rating, 0), (SELECT COALESCE(MAX(rating), 0) FROM assets WHERE id IN (${marks}))),
           flag = CASE WHEN flag = 'pick' OR EXISTS (SELECT 1 FROM assets WHERE id IN (${marks}) AND flag = 'pick') THEN 'pick' ELSE flag END,
           title = COALESCE(title, (SELECT title FROM assets WHERE id IN (${marks}) AND title IS NOT NULL LIMIT 1)),
           caption = COALESCE(caption, (SELECT caption FROM assets WHERE id IN (${marks}) AND caption IS NOT NULL LIMIT 1)),
           updated_at = ?
         WHERE id = ?`,
      )
      .bind(...others, ...others, ...others, ...others, now, keep),
  ])
  await db.prepare("UPDATE assets SET rating = NULLIF(rating, 0) WHERE id = ?").bind(keep).run()
  for (const id of others) await softDeleteAsset(db, id)
  await indexAsset(db, keep)
  return others.length
}

/**
 * Mark look-alike pairs as "not duplicates": every pair among `ids`, or, with `only`, just the pairs
 * between that one asset and the rest (taking one photo out of a group without breaking up the group).
 */
export async function dismissPairs(db: D1Database, ids: string[], only?: string): Promise<number> {
  const marks = ids.map(() => '?').join(',')
  const result = only
    ? await db
        .prepare(`UPDATE similar_pairs SET dismissed = 1 WHERE (a = ? AND b IN (${marks})) OR (b = ? AND a IN (${marks}))`)
        .bind(only, ...ids, only, ...ids)
        .run()
    : await db.prepare(`UPDATE similar_pairs SET dismissed = 1 WHERE a IN (${marks}) AND b IN (${marks})`).bind(...ids, ...ids).run()
  return result.meta.changes
}

export async function duplicateCounts(db: D1Database): Promise<{ exact: number; similar: number }> {
  const [exact, similar] = await Promise.all([exactGroups(db, 0), similarGroups(db, 0)])
  return { exact: exact.total, similar: similar.total }
}
