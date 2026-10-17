/**
 * AI review of the catalogue: settings, the queue, running an analysis, and accepting suggestions.
 *
 * Suggestions (alt text, caption) are stored beside what people wrote and only replace it when someone
 * accepts them. AI tags are added with source 'ai': searchable at once, shown apart, removable, or kept.
 */
import type { DamBindings } from '../env'
import { nowIso } from '../lib/time'
import { addTags, getAsset, getTags } from './assets'
import { matchKeywords } from './keywords'
import { indexAsset } from './search'
import { analyzeImage, DEFAULT_VISION_MODEL, modelImage, USD_PER_1000_NEURONS, VISION_MODELS } from './vision'

export interface AiSettings {
  enabled: boolean
  /** Analyse new uploads automatically. */
  auto: boolean
  model: string
  /** Free text the model is told about the archive, e.g. "Wedding photographer in Bergen". */
  context: string
}

const KEYS = { enabled: 'ai.enabled', auto: 'ai.auto', model: 'ai.model', context: 'ai.context' } as const

export async function getAiSettings(db: D1Database): Promise<AiSettings> {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'ai.%'").all<{ key: string; value: string }>()
  const map = new Map(results.map((r) => [r.key, r.value]))
  const model = map.get(KEYS.model)
  return {
    enabled: map.get(KEYS.enabled) !== 'false',
    auto: map.get(KEYS.auto) !== 'false',
    model: model && VISION_MODELS.some((m) => m.id === model) ? model : DEFAULT_VISION_MODEL,
    context: map.get(KEYS.context) ?? '',
  }
}

export async function saveAiSettings(db: D1Database, patch: Partial<AiSettings>): Promise<AiSettings> {
  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  const put = (key: string, value: string) =>
    statements.push(db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(key, value, now))
  if (patch.enabled !== undefined) put(KEYS.enabled, String(patch.enabled))
  if (patch.auto !== undefined) put(KEYS.auto, String(patch.auto))
  if (patch.model !== undefined) put(KEYS.model, patch.model)
  if (patch.context !== undefined) put(KEYS.context, patch.context)
  if (statements.length > 0) await db.batch(statements)
  return getAiSettings(db)
}

/** Whether AI can run at all here: the binding exists and it is switched on. */
export async function aiAvailable(env: DamBindings): Promise<boolean> {
  return Boolean(env.AI) && (await getAiSettings(env.DB)).enabled
}

/** Queue assets that have a preview for analysis. Returns how many were queued. */
export async function queueForAi(db: D1Database, ids: string[] | 'unanalysed'): Promise<number> {
  const hasPreview = "EXISTS (SELECT 1 FROM renditions r WHERE r.asset_id = assets.id)"
  if (ids === 'unanalysed') {
    const result = await db
      .prepare(`UPDATE assets SET ai_status = 'queued', ai_error = NULL WHERE deleted_at IS NULL AND ${hasPreview} AND (ai_status IS NULL OR ai_status = 'failed')`)
      .run()
    return result.meta.changes
  }
  let queued = 0
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90)
    const result = await db
      .prepare(`UPDATE assets SET ai_status = 'queued', ai_error = NULL WHERE deleted_at IS NULL AND ${hasPreview} AND id IN (${slice.map(() => '?').join(',')})`)
      .bind(...slice)
      .run()
    queued += result.meta.changes
  }
  return queued
}

/** Run the model on one asset now and store what it found. */
export async function analyzeAsset(env: DamBindings, assetId: string): Promise<'done' | 'failed' | 'skipped'> {
  const db = env.DB
  if (!env.AI) return 'skipped'
  const asset = await getAsset(db, assetId)
  if (!asset) {
    await db.prepare("UPDATE assets SET ai_status = 'skipped' WHERE id = ?").bind(assetId).run()
    return 'skipped'
  }
  const settings = await getAiSettings(db)
  try {
    const image = await modelImage(env, assetId)
    if (!image) {
      await db.prepare("UPDATE assets SET ai_status = 'skipped', ai_error = 'No preview to analyse.' WHERE id = ?").bind(assetId).run()
      return 'skipped'
    }
    const userTags = (await getTags(db, assetId)).filter((t) => t.source !== 'ai').map((t) => t.name)
    const result = await analyzeImage(env.AI, settings.model, image, {
      photographer: settings.context || null,
      filename: asset.filename,
      existingKeywords: userTags,
      capturedAt: asset.captured_at,
    })
    await db
      .prepare(
        `UPDATE assets SET ai_status = 'done', ai_model = ?, ai_analyzed_at = ?, ai_alt = ?, ai_caption = ?, ai_description = ?,
           ai_quality = ?, ai_people = ?, ai_text = ?, ai_neurons = ?, ai_error = NULL WHERE id = ?`,
      )
      .bind(settings.model, nowIso(), result.alt || null, result.caption || null, result.description || null, result.quality, result.people, result.text || null, result.usage?.neurons ?? null, assetId)
      .run()
    // Replace the previous run's AI tags; people's own tags are untouched.
    await db.prepare("DELETE FROM asset_tags WHERE asset_id = ? AND source = 'ai'").bind(assetId).run()
    const fresh = result.tags.filter((t) => !userTags.some((u) => u.toLowerCase() === t))
    await addTags(db, assetId, fresh, 'ai')
    await indexAsset(db, assetId)
    return 'done'
  } catch (error) {
    console.warn('[ai] analysis failed', assetId, error)
    await db
      .prepare("UPDATE assets SET ai_status = 'failed', ai_error = ? WHERE id = ?")
      .bind(error instanceof Error ? error.message.slice(0, 300) : 'Analysis failed', assetId)
      .run()
    return 'failed'
  }
}

export type AcceptField = 'alt' | 'caption' | 'tags'

/**
 * Accept AI suggestions. Alt text and caption fill only empty fields unless `overwrite` is set; AI
 * tags become the person's own.
 */
export async function acceptSuggestions(db: D1Database, ids: string[], fields: AcceptField[], overwrite = false): Promise<void> {
  const now = nowIso()
  for (const id of ids) {
    const statements: D1PreparedStatement[] = []
    for (const field of fields) {
      if (field === 'tags') {
        statements.push(db.prepare("UPDATE asset_tags SET source = 'user' WHERE asset_id = ? AND source = 'ai'").bind(id))
      } else {
        const condition = overwrite ? '' : `AND (${field} IS NULL OR ${field} = '')`
        statements.push(db.prepare(`UPDATE assets SET ${field} = ai_${field}, updated_at = ? WHERE id = ? AND ai_${field} IS NOT NULL ${condition}`).bind(now, id))
      }
    }
    if (statements.length > 0) await db.batch(statements)
    await indexAsset(db, id)
  }
}

export async function removeAiTag(db: D1Database, id: string, tag: string): Promise<void> {
  const ids = await matchKeywords(db, tag)
  if (ids.length === 0) return
  await db.prepare(`DELETE FROM asset_tags WHERE asset_id = ? AND source = 'ai' AND tag_id IN (${ids.map(() => '?').join(',')})`).bind(id, ...ids).run()
  await indexAsset(db, id)
}

export interface AiStats {
  analysed: number
  queued: number
  failed: number
  /** Photos with a preview that have never been analysed. */
  waiting: number
  averageNeurons: number | null
  usdPerPhoto: number | null
}

export async function aiStats(db: D1Database): Promise<AiStats> {
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN ai_status = 'done' THEN 1 ELSE 0 END) AS analysed,
         SUM(CASE WHEN ai_status = 'queued' THEN 1 ELSE 0 END) AS queued,
         SUM(CASE WHEN ai_status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN ai_status IS NULL AND EXISTS (SELECT 1 FROM renditions r WHERE r.asset_id = assets.id) THEN 1 ELSE 0 END) AS waiting,
         AVG(ai_neurons) AS neurons
       FROM assets WHERE deleted_at IS NULL`,
    )
    .first<{ analysed: number | null; queued: number | null; failed: number | null; waiting: number | null; neurons: number | null }>()
  const neurons = row?.neurons ?? null
  return {
    analysed: row?.analysed ?? 0,
    queued: row?.queued ?? 0,
    failed: row?.failed ?? 0,
    waiting: row?.waiting ?? 0,
    averageNeurons: neurons === null ? null : Math.round(neurons * 10) / 10,
    usdPerPhoto: neurons === null ? null : (neurons / 1000) * USD_PER_1000_NEURONS,
  }
}
