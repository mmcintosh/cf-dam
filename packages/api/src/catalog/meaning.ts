/**
 * Search by meaning: "birds by the water" finds the heron nobody keyworded "bird", and a photo's
 * "More like this" finds others about the same thing.
 *
 * Each photo's words (title, caption, keywords, place, what the AI saw: the search index's text) are
 * turned into a vector by a Workers AI embedding model and kept in a Vectorize index (`VECTORS`),
 * under the photo's id. A search's words are turned into a vector the same way and the index returns
 * the nearest photos. It's about words, not pixels: Workers AI has no image-embedding model we can
 * call, so a photo with nothing written about it (and no AI review) can't be found this way.
 *
 * `assets.meaning_at` is when a photo's vector was last checked (NULL: check it, which indexing sets
 * whenever the text may have changed), `meaning_hash` the text it was made from, so unchanged text
 * costs no AI call. Without the VECTORS binding, or with AI off, all of this is simply absent.
 */
import type { DamBindings } from '../env'
import { sha256Hex } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { aiAvailable } from './ai'
import type { ListFilters } from './assets'

/**
 * Chosen against bge-m3 and EmbeddingGemma on Workers AI (22 Oct 2026): with the query instruction,
 * matching descriptions scored 0.57–0.69 and others at most 0.36, and a Spanish query still found its
 * photo. 1,024 dimensions, cosine: the Vectorize index must be made to match.
 */
export const MEANING_MODEL = '@cf/qwen/qwen3-embedding-0.6b'
export const MEANING_DIMENSIONS = 1024
const QUERY_INSTRUCTION = 'Instruct: Given a photo search query, find photo descriptions that match it\nQuery: '
/** Photos per embedding call (the model takes up to 100 texts). */
const BATCH = 50
/** Text per photo, in characters: plenty for a description, and keeps a call small. */
const MAX_TEXT = 2000
/** Nearest photos a search returns, at most: Vectorize's own limit ("max top K is 100"). */
export const NEAREST = 100
/** Below this a match is about something else (see MEANING_MODEL). */
export const MIN_SCORE = 0.4

export async function meaningAvailable(env: DamBindings): Promise<boolean> {
  return Boolean(env.VECTORS) && (await aiAvailable(env))
}

async function embed(ai: Ai, texts: string[]): Promise<number[][]> {
  const out = (await ai.run(MEANING_MODEL as Parameters<Ai['run']>[0], { text: texts } as never)) as { data?: number[][]; response?: number[][] }
  const vectors = out.data ?? out.response
  if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new Error('The embedding model returned no vectors.')
  return vectors
}

interface TextRow {
  id: string
  meaning_hash: string | null
  title: string | null
  caption: string | null
  tags: string | null
  place: string | null
  ai: string | null
}

/** What a photo is understood by, from its search index row (not the filename or camera: they say nothing of the picture). */
export function meaningText(row: Omit<TextRow, 'id' | 'meaning_hash'>): string {
  const parts = [row.title, row.caption, row.ai, row.tags && `Keywords: ${row.tags}`, row.place].map((p) => p?.trim()).filter(Boolean)
  return parts.join('. ').slice(0, MAX_TEXT)
}

/**
 * The sweep's share: forget deleted photos, then make vectors for photos whose text changed, a batch
 * at a time while `more` allows. Returns how many photos it embedded.
 */
export async function meaningStep(env: DamBindings, more: () => boolean): Promise<number> {
  const db = env.DB
  const vectors = env.VECTORS
  if (!vectors || !env.AI || !(await meaningAvailable(env))) return 0
  const { results: gone } = await db
    .prepare('SELECT id FROM assets WHERE deleted_at IS NOT NULL AND meaning_hash IS NOT NULL LIMIT 1000')
    .all<{ id: string }>()
  if (gone.length > 0) {
    await vectors.deleteByIds(gone.map((g) => g.id))
    await db.prepare('UPDATE assets SET meaning_hash = NULL WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(gone.map((g) => g.id))).run()
  }
  let embedded = 0
  while (more()) {
    const { results } = await db
      .prepare(
        `SELECT a.id, a.meaning_hash, s.title, s.caption, s.tags, s.place, s.ai
         FROM assets a JOIN search_index s ON s.rowid = a.search_id
         WHERE a.meaning_at IS NULL AND a.indexed_at IS NOT NULL AND a.deleted_at IS NULL
         ORDER BY a.created_at LIMIT ?`,
      )
      .bind(BATCH)
      .all<TextRow>()
    if (results.length === 0) break
    const rows = await Promise.all(
      results.map(async (r) => {
        const text = meaningText(r)
        return { id: r.id, text, before: r.meaning_hash, hash: text ? (await sha256Hex(text)).slice(0, 32) : null }
      }),
    )
    const changed = rows.filter((r) => r.hash && r.hash !== r.before)
    if (changed.length > 0) {
      const values = await embed(env.AI, changed.map((r) => r.text))
      await vectors.upsert(changed.map((r, i) => ({ id: r.id, values: values[i]! })))
      embedded += changed.length
    }
    // Nothing written about it any more: its old vector goes.
    const emptied = rows.filter((r) => !r.hash && r.before).map((r) => r.id)
    if (emptied.length > 0) await vectors.deleteByIds(emptied)
    await db
      .prepare(
        `UPDATE assets SET meaning_at = ?, meaning_hash = json_extract(j.value, '$[1]')
         FROM json_each(?) j WHERE assets.id = json_extract(j.value, '$[0]')`,
      )
      .bind(nowIso(), JSON.stringify(rows.map((r) => [r.id, r.hash])))
      .run()
  }
  return embedded
}

/** Photos nearest in meaning to some words, or to a photo, nearest first (the photo itself left out). */
export async function nearest(env: DamBindings, by: { text: string } | { assetId: string }): Promise<string[]> {
  const vectors = env.VECTORS
  if (!vectors || !env.AI || !(await meaningAvailable(env))) return []
  let values: number[]
  if ('text' in by) {
    values = (await embed(env.AI, [QUERY_INSTRUCTION + by.text.slice(0, 500)]))[0]!
  } else {
    const [own] = await vectors.getByIds([by.assetId])
    if (!own) return []
    values = [...own.values]
  }
  const { matches } = await vectors.query(values, { topK: NEAREST })
  return matches.filter((m) => m.score >= MIN_SCORE && !('assetId' in by && m.id === by.assetId)).map((m) => m.id)
}

/**
 * Library filters with `meaning` (words) or `like` (a photo id) turned into the photos they find
 * (`near`), so the rest of the list query can narrow and order by them.
 */
export async function resolveNear(env: DamBindings, filters: ListFilters): Promise<ListFilters> {
  if (!filters.like && !filters.meaning) return filters
  try {
    const near = await nearest(env, filters.like ? { assetId: filters.like } : { text: filters.meaning! })
    return { ...filters, near }
  } catch (error) {
    // The library still opens: the search finds nothing, and the log says why.
    console.warn('[meaning] search failed', error)
    return { ...filters, near: [] }
  }
}
