/**
 * Duplicates: exact copies (same SHA-256) and look-alikes (perceptual hashes within a few bits).
 * Resolving a group keeps one asset and soft-deletes the rest, after folding their tags, albums,
 * best rating and any pick into the one kept, so nothing anyone added is lost.
 */
import { nowIso } from '../lib/time'
import { assetJson, CONTENT_KEY, locationsOf, primaryLocation, renditionNames, softDeleteAssets, type AssetJson, type AssetRow } from './assets'
import { getStats } from './stats'
import { indexAsset } from './search'

type Member = AssetJson & { albums: number; tags: number }

export interface DuplicateGroup {
  key: string
  kind: 'exact' | 'similar'
  /** Members, best first: the one cf-dam suggests keeping. */
  assets: Member[]
  /** Why the first is suggested, in a few words. */
  reason: string
}

/** RAW originals over lossless TIFF and PNG over compressed formats (JPEG, HEIC, WebP). */
const formatRank = (mime: string) => (mime.startsWith('image/x-') ? 2 : mime === 'image/tiff' || mime === 'image/png' ? 1 : 0)
const pixels = (a: Member) => (a.width ?? 0) * (a.height ?? 0)
/** Within 2%: a pixel or two cropped off isn't a better photo. */
const samePixels = (x: Member, y: Member) => Math.abs(pixels(x) - pixels(y)) <= 0.02 * Math.max(pixels(x), pixels(y))
const bytes = (b: number) => (b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`)

/**
 * What decides between two members, best first, with the reason as people would put it. Quality
 * first (the others' keywords, albums, rating and pick move to the one kept): more pixels; then the
 * original format; then, the same size in the same format, the bigger file, which is the less
 * compressed one. Only then a pick, a higher rating, and the one that came in first.
 */
function decide(x: Member, y: Member): { order: number; reason: string } {
  if (!samePixels(x, y)) {
    return { order: pixels(y) - pixels(x), reason: 'More pixels' }
  }
  if (formatRank(x.mimeType) !== formatRank(y.mimeType)) {
    return { order: formatRank(y.mimeType) - formatRank(x.mimeType), reason: Math.max(formatRank(x.mimeType), formatRank(y.mimeType)) === 2 ? 'The RAW original' : 'Lossless, not compressed' }
  }
  if (x.size !== y.size && !x.mimeType.startsWith('video/')) {
    const [big, small] = x.size > y.size ? [x, y] : [y, x]
    // Less than 5% apart: re-saved with other metadata, not a different quality.
    if (big.size > small.size * 1.05) return { order: y.size - x.size, reason: `The same size, but less compressed (${bytes(big.size)} against ${bytes(small.size)})` }
  }
  if ((x.flag === 'pick') !== (y.flag === 'pick')) return { order: Number(y.flag === 'pick') - Number(x.flag === 'pick'), reason: 'Your pick' }
  if ((x.rating ?? 0) !== (y.rating ?? 0)) return { order: (y.rating ?? 0) - (x.rating ?? 0), reason: 'Rated higher' }
  return { order: x.createdAt.localeCompare(y.createdAt), reason: 'Otherwise alike: the one that came in first' }
}

/**
 * Groups as shown: each member with where it is, its previews and how many albums and keywords it
 * has, best first. Four queries for all the groups together.
 */
async function withDetails(db: D1Database, groups: { key: string; kind: DuplicateGroup['kind']; rows: AssetRow[] }[]): Promise<DuplicateGroup[]> {
  const ids = groups.flatMap((g) => g.rows.map((r) => r.id))
  const renditions = await renditionNames(db, ids)
  const locations = await locationsOf(db, ids)
  const counts = new Map(ids.map((id) => [id, { albums: 0, tags: 0 }]))
  if (ids.length > 0) {
    const list = JSON.stringify(ids)
    const [albums, tags] = await db.batch<{ id: string; n: number }>([
      db.prepare('SELECT asset_id AS id, COUNT(*) AS n FROM album_items WHERE asset_id IN (SELECT value FROM json_each(?)) GROUP BY asset_id').bind(list),
      db.prepare('SELECT asset_id AS id, COUNT(*) AS n FROM asset_tags WHERE asset_id IN (SELECT value FROM json_each(?)) GROUP BY asset_id').bind(list),
    ])
    for (const r of albums!.results) counts.get(r.id)!.albums = r.n
    for (const r of tags!.results) counts.get(r.id)!.tags = r.n
  }
  return groups.map(({ key, kind, rows }) => {
    const assets = rows
      .map((row) => ({ ...assetJson(row, renditions.get(row.id) ?? [], primaryLocation(locations.get(row.id) ?? [])), ...counts.get(row.id)! }))
      .sort((x, y) => decide(x, y).order)
    const reason = assets.length > 1 ? decide(assets[0]!, assets[1]!).reason : ''
    return { key, kind, assets, reason: kind === 'exact' && reason.startsWith('Otherwise') ? 'Identical files: the one that came in first' : reason }
  })
}

/** The same file more than once: same quick fingerprint (helpers, uploads since 0036) or, before that, SHA-256. */
export async function exactGroups(db: D1Database, limit = 50): Promise<{ groups: DuplicateGroup[]; total: number }> {
  // One photo's rowid stands for each group: the index has the key, but returning the key itself
  // would read every row to work it out (5.2 s at 1.4 million, against 0.5 s).
  const [samples, total] = await db.batch([
    db
      .prepare(
        `SELECT MIN(rowid) AS sample FROM assets WHERE deleted_at IS NULL AND ${CONTENT_KEY} IS NOT NULL
         GROUP BY ${CONTENT_KEY} HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC, MIN(created_at) LIMIT ?`,
      )
      .bind(limit),
    db.prepare(
      `SELECT COUNT(*) AS n FROM (SELECT 1 FROM assets WHERE deleted_at IS NULL AND ${CONTENT_KEY} IS NOT NULL GROUP BY ${CONTENT_KEY} HAVING COUNT(*) > 1)`,
    ),
  ])
  const order = (samples!.results as { sample: number }[]).map((r) => r.sample)
  const { results: rows } = order.length
    ? await db
        .prepare(
          `SELECT a.*, COALESCE(a.quick_hash, a.sha256) AS content, s.rowid AS sample FROM assets s JOIN assets a ON COALESCE(a.quick_hash, a.sha256) = COALESCE(s.quick_hash, s.sha256)
           WHERE s.rowid IN (SELECT value FROM json_each(?)) AND a.deleted_at IS NULL`,
        )
        .bind(JSON.stringify(order))
        .all<AssetRow & { content: string; sample: number }>()
    : { results: [] as (AssetRow & { content: string; sample: number })[] }
  const groups = await withDetails(
    db,
    order.map((sample) => {
      const members = rows.filter((r) => r.sample === sample)
      return { key: members[0]?.content ?? String(sample), kind: 'exact' as const, rows: members }
    }),
  )
  return { groups, total: ((total!.results[0] as { n: number } | undefined)?.n) ?? 0 }
}

/** Locations per step of the quick-fingerprint fill: about 0.4 s at 1.4 million photos. */
const FILL_STEP = 5000

/**
 * Photos a helper indexed before 0036 get their quick fingerprint from their location, a step at a
 * time, while `more()`. Returns how many photos were filled; the setting goes when it's all done.
 */
export async function fillQuickHashes(db: D1Database, more: () => boolean, from?: string): Promise<number> {
  let filled = 0
  let at = from
  while (more()) {
    at ??= (await db.prepare("SELECT value FROM settings WHERE key = 'quick_hash.fill'").first<{ value: string }>())?.value
    if (at === undefined) break
    const window = `SELECT rowid AS rid, asset_id, quick_hash FROM asset_locations WHERE rowid > ? ORDER BY rowid LIMIT ${FILL_STEP}`
    const cursor = Number(at) || 0
    const [updated, moved, finished] = await db.batch([
      db.prepare(`UPDATE assets SET quick_hash = l.quick_hash FROM (${window}) l WHERE assets.id = l.asset_id AND l.quick_hash IS NOT NULL AND assets.quick_hash IS NULL`).bind(cursor),
      db.prepare(`UPDATE settings SET value = COALESCE((SELECT MAX(rid) FROM (${window})), 'done'), updated_at = ? WHERE key = 'quick_hash.fill' RETURNING value`).bind(cursor, nowIso()),
      db.prepare("DELETE FROM settings WHERE key = 'quick_hash.fill' AND value = 'done'"),
    ])
    filled += updated!.meta.changes ?? 0
    if ((finished!.meta.changes ?? 0) > 0) break
    at = (moved!.results[0] as { value: string } | undefined)?.value
  }
  return filled
}

/** Look-alike groups from undismissed pairs (exact copies are left to the exact tab). */
export async function similarGroups(db: D1Database, limit = 50): Promise<{ groups: DuplicateGroup[]; total: number }> {
  const { results: pairs } = await db
    .prepare(
      `SELECT p.a, p.b FROM similar_pairs p
       JOIN assets x ON x.id = p.a AND x.deleted_at IS NULL
       JOIN assets y ON y.id = p.b AND y.deleted_at IS NULL
       WHERE p.dismissed = 0 AND NOT (COALESCE(x.quick_hash, x.sha256) IS NOT NULL AND COALESCE(x.quick_hash, x.sha256) = COALESCE(y.quick_hash, y.sha256))
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

  const shown = sorted.slice(0, limit)
  const { results: rows } = shown.length
    ? await db.prepare('SELECT * FROM assets WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(shown.flat())).all<AssetRow>()
    : { results: [] as AssetRow[] }
  const byId = new Map(rows.map((r) => [r.id, r]))
  const groups = await withDetails(
    db,
    shown
      .map((ids) => ({ key: [...ids].sort()[0]!, kind: 'similar' as const, rows: ids.map((id) => byId.get(id)).filter((r): r is AssetRow => r !== undefined) }))
      .filter((g) => g.rows.length > 1),
  )
  return { groups, total: sorted.length }
}

/** Keep one asset, fold the others' metadata into it, then soft-delete them. */
export async function keepOne(db: D1Database, keep: string, remove: string[]): Promise<number> {
  const others = remove.filter((id) => id !== keep)
  if (others.length === 0) return 0
  const list = JSON.stringify(others)
  const marks = 'SELECT value FROM json_each(?)'
  const now = nowIso()
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, source, created_at) SELECT ?, tag_id, source, ? FROM asset_tags WHERE asset_id IN (${marks})`).bind(keep, now, list),
    db.prepare(`INSERT OR IGNORE INTO album_items (album_id, asset_id, position, added_at) SELECT album_id, ?, position, ? FROM album_items WHERE asset_id IN (${marks})`).bind(keep, now, list),
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
      .bind(list, list, list, list, now, keep),
  ])
  await db.prepare("UPDATE assets SET rating = NULLIF(rating, 0) WHERE id = ?").bind(keep).run()
  await softDeleteAssets(db, others)
  await indexAsset(db, keep)
  return others.length
}

/**
 * Mark look-alike pairs as "not duplicates": every pair among `ids`, or, with `only`, just the pairs
 * between that one asset and the rest (taking one photo out of a group without breaking up the group).
 */
export async function dismissPairs(db: D1Database, ids: string[], only?: string): Promise<number> {
  const list = JSON.stringify(ids)
  const marks = 'SELECT value FROM json_each(?)'
  const result = only
    ? await db
        .prepare(`UPDATE similar_pairs SET dismissed = 1 WHERE (a = ? AND b IN (${marks})) OR (b = ? AND a IN (${marks}))`)
        .bind(only, list, only, list)
        .run()
    : await db.prepare(`UPDATE similar_pairs SET dismissed = 1 WHERE a IN (${marks}) AND b IN (${marks})`).bind(list, list).run()
  return result.meta.changes
}

/** Exact groups from the sweep's snapshot when there is one, else counted from idx_assets_live_content (0.3 s at 1.4 million). */
export async function duplicateCounts(db: D1Database): Promise<{ exact: number; similar: number }> {
  const [stats, similar] = await Promise.all([getStats(db), similarGroups(db, 0)])
  const exact = stats ? stats.exactDuplicateGroups : (await exactGroups(db, 0)).total
  return { exact, similar: similar.total }
}
