/**
 * Full-text index over assets (FTS5), kept in step by the application.
 *
 * Each asset's row in `search_index` has the asset's `search_id` as its rowid, so replacing or
 * removing it is a lookup, not a scan. `assets.indexed_at` is when it was last written; NULL means
 * it needs (re)writing, which the sweep does for any it finds.
 */
import { iptcSearchText } from './iptc'
import { searchTerms } from './keywords'

/** Assets the index is missing or behind on, for the sweep to repair. */
export async function unindexed(db: D1Database, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT id FROM assets WHERE indexed_at IS NULL AND deleted_at IS NULL AND status != 'uploading' ORDER BY created_at LIMIT ?`)
    .bind(limit)
    .all<{ id: string }>()
  return results.map((r) => r.id)
}

/** Leave these for the sweep to reindex (more than a request should do itself). */
export async function markUnindexed(db: D1Database, assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return
  await db.prepare('UPDATE assets SET indexed_at = NULL WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(assetIds)).run()
}

interface IndexRow {
  id: string
  deleted_at: string | null
  filename: string
  title: string | null
  caption: string | null
  camera_make: string | null
  camera_model: string | null
  lens: string | null
  ai_description: string | null
  ai_caption: string | null
  ai_text: string | null
}

/** Assets per round of writes: their text (AI descriptions, captions) is bound as one JSON value. */
const CHUNK = 50

/** Write (or remove, for deleted assets) the index rows of these assets: three round trips per 50. */
export async function indexAssets(db: D1Database, assetIds: string[]): Promise<void> {
  const unique = [...new Set(assetIds)]
  for (let i = 0; i < unique.length; i += CHUNK) {
    const ids = unique.slice(i, i + CHUNK)
    const { results: rows } = await db
      .prepare(
        `SELECT a.id, a.deleted_at, a.filename, a.title, a.caption, a.camera_make, a.camera_model, a.lens, a.ai_description, a.ai_caption, a.ai_text,
                a.headline, a.creator, a.credit, a.source, a.job_id, a.sublocation, a.city, a.state, a.country
         FROM assets a WHERE a.id IN (SELECT value FROM json_each(?))`,
      )
      .bind(JSON.stringify(ids))
      .all<IndexRow>()
    const live = rows.filter((r) => !r.deleted_at)
    const terms = await searchTerms(db, live.map((r) => r.id))
    const docs = live.map((row) => {
      const place = iptcSearchText(row as unknown as Record<string, unknown>)
      return {
        id: row.id,
        // Filenames index better with their separators as spaces: "IMG_2041-final" → "IMG 2041 final".
        filename: `${row.filename} ${row.filename.replace(/[._\-]+/g, ' ')}`,
        title: [row.title, place.extra].filter(Boolean).join(' '),
        caption: row.caption ?? '',
        // Keywords with their ancestors and synonyms: a photo tagged Bergen is found by "norway".
        tags: terms.get(row.id) ?? '',
        camera: [row.camera_make, row.camera_model, row.lens].filter(Boolean).join(' '),
        place: place.place,
        // What the AI saw (and any text in the picture), so "red boat at dusk" finds photos nobody has keyworded.
        ai: [row.ai_caption, row.ai_description, row.ai_text].filter(Boolean).join(' '),
      }
    })
    const list = JSON.stringify(ids)
    const field = (name: string) => `json_extract(j.value, '$.${name}')`
    await db.batch([
      // A search id for assets that have none yet: one above the highest, in list order.
      db
        .prepare(
          `UPDATE assets SET search_id = m.top + j.key + 1
           FROM json_each(?) j, (SELECT COALESCE(MAX(search_id), 0) AS top FROM assets) m
           WHERE assets.id = j.value AND assets.search_id IS NULL`,
        )
        .bind(JSON.stringify(live.map((r) => r.id))),
      db.prepare('DELETE FROM search_index WHERE rowid IN (SELECT search_id FROM assets WHERE id IN (SELECT value FROM json_each(?)))').bind(list),
      db
        .prepare(
          `INSERT INTO search_index (rowid, filename, title, caption, tags, camera, place, ai)
           SELECT a.search_id, ${['filename', 'title', 'caption', 'tags', 'camera', 'place', 'ai'].map(field).join(', ')}
           FROM json_each(?) j JOIN assets a ON a.id = ${field('id')}`,
        )
        .bind(JSON.stringify(docs)),
      // The text may have changed: search by meaning checks it again (catalog/meaning.ts).
      db.prepare("UPDATE assets SET indexed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), meaning_at = NULL WHERE id IN (SELECT value FROM json_each(?))").bind(list),
    ])
  }
}

export const indexAsset = (db: D1Database, assetId: string) => indexAssets(db, [assetId])

/** SQL: asset `a` matches a search (see toFtsQuery). */
export const SEARCH_MATCH = 'a.search_id IN (SELECT rowid FROM search_index WHERE search_index MATCH ?)'

/**
 * Turn what a person typed into a safe FTS5 query: each word becomes a quoted prefix term, so
 * punctuation and FTS operators in the input can't break or widen the query.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .normalize('NFKC')
    .split(/\s+/)
    .map((term) => term.replace(/["*^:(){}[\]]/g, '').trim())
    .filter((term) => term.length > 0)
    .slice(0, 12)
  return terms.length > 0 ? terms.map((t) => `"${t}"*`).join(' ') : null
}
