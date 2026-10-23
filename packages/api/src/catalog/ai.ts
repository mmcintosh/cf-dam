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
import { indexAsset, indexAssets } from './search'
import { analyzeImage, DEFAULT_VISION_MODEL, modelImage, USD_PER_1000_NEURONS, VISION_MODELS } from './vision'
import { asLanguage, type Language } from '@cf-dam/i18n'
import { say, siteLanguage } from '../lib/language'

export interface AiSettings {
  enabled: boolean
  /** Analyse new uploads automatically. */
  auto: boolean
  model: string
  /** Free text the model is told about the archive, e.g. "Wedding photographer in Bergen". */
  context: string
  /** What suggestions are written in: 'site' follows the archive's language (settings `site.language`). */
  language: Language | 'site'
}

const KEYS = { enabled: 'ai.enabled', auto: 'ai.auto', model: 'ai.model', context: 'ai.context', language: 'ai.language' } as const

export async function getAiSettings(db: D1Database): Promise<AiSettings> {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'ai.%'").all<{ key: string; value: string }>()
  const map = new Map(results.map((r) => [r.key, r.value]))
  const model = map.get(KEYS.model)
  return {
    enabled: map.get(KEYS.enabled) !== 'false',
    auto: map.get(KEYS.auto) !== 'false',
    model: model && VISION_MODELS.some((m) => m.id === model) ? model : DEFAULT_VISION_MODEL,
    context: map.get(KEYS.context) ?? '',
    language: (asLanguage(map.get(KEYS.language)) as Language | null) ?? 'site',
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
  if (patch.language !== undefined) put(KEYS.language, patch.language)
  if (statements.length > 0) await db.batch(statements)
  return getAiSettings(db)
}

/** Tries per photo before a backfill leaves it alone (each one is billed). */
export const AI_MAX_ATTEMPTS = 3
/** A photo 'running' for longer than this was left by a run that died. */
export const AI_RUNNING_STALE_MS = 10 * 60_000

/** Why photos can't be queued for analysis while AI review is switched off. */
export const aiOff = () => say('err.aiOff')

/** Whether AI can run at all here: the binding exists and it is switched on. */
export async function aiAvailable(env: DamBindings): Promise<boolean> {
  return Boolean(env.AI) && (await getAiSettings(env.DB)).enabled
}

/**
 * Queue assets that have a preview for analysis. Returns how many were queued. A backfill
 * ('unanalysed') takes failed photos only while they have tries left; photos chosen by hand start
 * their count again. A photo being analysed right now is left to finish.
 */
export async function queueForAi(db: D1Database, ids: string[] | 'unanalysed'): Promise<number> {
  const hasPreview = "EXISTS (SELECT 1 FROM renditions r WHERE r.asset_id = assets.id)"
  if (ids === 'unanalysed') {
    const result = await db
      .prepare(
        `UPDATE assets SET ai_status = 'queued', ai_error = NULL WHERE deleted_at IS NULL AND ${hasPreview}
           AND (ai_status IS NULL OR (ai_status = 'failed' AND ai_attempts < ?))`,
      )
      .bind(AI_MAX_ATTEMPTS)
      .run()
    return result.meta.changes
  }
  const result = await db
    .prepare(
      `UPDATE assets SET ai_status = 'queued', ai_error = NULL, ai_attempts = 0
       WHERE deleted_at IS NULL AND ${hasPreview} AND id IN (SELECT value FROM json_each(?)) AND ai_status IS NOT 'running'`,
    )
    .bind(JSON.stringify(ids))
    .run()
  return result.meta.changes
}

/**
 * Claim one photo for analysis now (the "Analyse" button), as the sweep claims its batch: false when
 * it is already being analysed, so two clicks, or a click during the sweep, don't pay twice.
 */
export async function claimForAi(db: D1Database, assetId: string): Promise<boolean> {
  const stale = new Date(Date.now() - AI_RUNNING_STALE_MS).toISOString()
  const claimed = await db
    .prepare(
      `UPDATE assets SET ai_status = 'running', ai_started_at = ?, ai_attempts = ai_attempts + 1
       WHERE id = ? AND deleted_at IS NULL AND NOT (ai_status IS 'running' AND ai_started_at > ?)`,
    )
    .bind(nowIso(), assetId, stale)
    .run()
  return claimed.meta.changes === 1
}

/**
 * Run the model on one asset, already claimed ('running'), and store what it found. Whatever goes
 * wrong, the photo ends up 'failed' with the reason, never left 'running'.
 */
export async function analyzeAsset(env: DamBindings, assetId: string): Promise<'done' | 'failed' | 'skipped'> {
  const db = env.DB
  if (!env.AI) return 'skipped'
  try {
    const asset = await getAsset(db, assetId)
    if (!asset) {
      await db.prepare("UPDATE assets SET ai_status = 'skipped' WHERE id = ?").bind(assetId).run()
      return 'skipped'
    }
    const settings = await getAiSettings(db)
    const image = await modelImage(env, assetId)
    if (!image) {
      await db.prepare("UPDATE assets SET ai_status = 'skipped', ai_error = 'No preview to analyse.' WHERE id = ?").bind(assetId).run()
      return 'skipped'
    }
    const userTags = (await getTags(db, assetId)).filter((t) => t.source !== 'ai').map((t) => t.name)
    const wanted = settings.language === 'site' ? ((await siteLanguage(db)) ?? 'en') : settings.language
    // A model that can't write the language writes English, and the review says so.
    const language = VISION_MODELS.find((m) => m.id === settings.model)?.languages === false ? 'en' : wanted
    const result = await analyzeImage(env.AI, settings.model, image, {
      photographer: settings.context || null,
      filename: asset.filename,
      existingKeywords: userTags,
      capturedAt: asset.captured_at,
      language,
    })
    await db
      .prepare(
        `UPDATE assets SET ai_status = 'done', ai_model = ?, ai_analyzed_at = ?, ai_alt = ?, ai_caption = ?, ai_description = ?,
           ai_quality = ?, ai_people = ?, ai_text = ?, ai_neurons = ?, ai_language = ?, ai_error = NULL WHERE id = ?`,
      )
      .bind(settings.model, nowIso(), result.alt || null, result.caption || null, result.description || null, result.quality, result.people, result.text || null, result.usage?.neurons ?? null, language, assetId)
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
      .catch(() => {}) // the database itself failing: the sweep's stale check puts it back
    return 'failed'
  }
}

export type AcceptField = 'alt' | 'caption' | 'tags'

/**
 * Accept AI suggestions. Alt text and caption fill only empty fields unless `overwrite` is set; AI
 * tags become the person's own.
 */
export async function acceptSuggestions(db: D1Database, ids: string[], fields: AcceptField[], overwrite = false): Promise<void> {
  if (ids.length === 0) return
  const now = nowIso()
  const list = JSON.stringify(ids)
  const statements = fields.map((field) => {
    if (field === 'tags') return db.prepare("UPDATE asset_tags SET source = 'user' WHERE asset_id IN (SELECT value FROM json_each(?)) AND source = 'ai'").bind(list)
    const condition = overwrite ? '' : `AND (${field} IS NULL OR ${field} = '')`
    return db.prepare(`UPDATE assets SET ${field} = ai_${field}, updated_at = ? WHERE id IN (SELECT value FROM json_each(?)) AND ai_${field} IS NOT NULL ${condition}`).bind(now, list)
  })
  if (statements.length > 0) await db.batch(statements)
  await indexAssets(db, ids)
}

export async function removeAiTag(db: D1Database, id: string, tag: string): Promise<void> {
  const ids = await matchKeywords(db, tag)
  if (ids.length === 0) return
  await db.prepare("DELETE FROM asset_tags WHERE asset_id = ? AND source = 'ai' AND tag_id IN (SELECT value FROM json_each(?))").bind(id, JSON.stringify(ids)).run()
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
