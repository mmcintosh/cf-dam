/** Full-text index over assets (FTS5), kept in step by the application. */
import { searchTerms } from './keywords'

/** Assets missing from the index (after a rebuild, or a failed write), for the sweep to repair. */
export async function unindexed(db: D1Database, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT id FROM assets WHERE deleted_at IS NULL AND status != 'uploading' AND id NOT IN (SELECT asset_id FROM assets_fts) LIMIT ?`)
    .bind(limit)
    .all<{ id: string }>()
  return results.map((r) => r.id)
}

interface IndexRow {
  filename: string
  title: string | null
  caption: string | null
  camera_make: string | null
  camera_model: string | null
  lens: string | null
  tags: string | null
  ai_description: string | null
  ai_caption: string | null
}

export async function indexAsset(db: D1Database, assetId: string): Promise<void> {
  const row = await db
    .prepare(
      `SELECT a.filename, a.title, a.caption, a.camera_make, a.camera_model, a.lens, a.ai_description, a.ai_caption,
              NULL AS tags
       FROM assets a WHERE a.id = ? AND a.deleted_at IS NULL`,
    )
    .bind(assetId)
    .first<IndexRow>()
  const statements = [db.prepare('DELETE FROM assets_fts WHERE asset_id = ?').bind(assetId)]
  if (row) {
    // Filenames index better with their separators as spaces: "IMG_2041-final" → "IMG 2041 final".
    const filename = `${row.filename} ${row.filename.replace(/[._\-]+/g, ' ')}`
    statements.push(
      db
        .prepare('INSERT INTO assets_fts (asset_id, filename, title, caption, tags, camera, place, ai) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(
          assetId,
          filename,
          row.title ?? '',
          row.caption ?? '',
          // Keywords with their ancestors and synonyms: a photo tagged Bergen is found by "norway".
          await searchTerms(db, assetId),
          [row.camera_make, row.camera_model, row.lens].filter(Boolean).join(' '),
          '',
          // What the AI saw, so "red boat at dusk" finds photos nobody has keyworded.
          [row.ai_caption, row.ai_description].filter(Boolean).join(' '),
        ),
    )
  }
  await db.batch(statements)
}

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
