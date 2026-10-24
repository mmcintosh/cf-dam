/**
 * Library facets from TypeSafe's Jev (plans/PLAN-F-v2.md), beside the Workers AI review: one request a photo says
 * whether there are people (and how many), animals, buildings, water… For now the Library filters on people; the
 * rest is stored for later. Measured against the AI review on staging: it found people in 87 photos where the
 * review found 47 (cf-dam-docs HANDOFF §19).
 *
 * The calls run on the work queue (kind 'facets'), four at a time; the sweep only puts failed photos back after a
 * pause, puts back ones a dead run left 'running', and nudges the queue when nothing is moving. Without the
 * TYPESAFE_API_KEY secret nothing is queued and the sweep asks nothing.
 *
 * What is sent: the 1,024 px JPEG the AI review sees (vision.ts modelImage), no filename or metadata. TypeSafe
 * strips metadata too. The photos leave Cloudflare: revisit before release.
 */
import type { DamBindings } from '../env'
import { classifyImage, type FacetResult } from '../lib/jev/facets'
import { TypeSafeRefused, typesafe } from '../lib/jev/typesafe'
import { nowIso } from '../lib/time'
import { modelImage } from './vision'

export const FACET_MAX_ATTEMPTS = 3
/** A failed photo is asked again this long after it failed (an outage or a rate limit passes). */
export const FACET_RETRY_MS = 15 * 60_000
/** Longer than any call (20 s, two retries with pauses): a photo 'running' this long was left by a dead run. */
export const FACET_RUNNING_STALE_MS = 10 * 60_000
/** Jev's smallest side. */
const MIN_SIDE = 280
/** The longest side of the image the model sees (vision.ts). */
const MODEL_SIDE = 1024

/** Photos the facets can be asked about: not videos (one frame says little), not deleted. */
const ASKABLE = "deleted_at IS NULL AND (mime_type IS NULL OR mime_type NOT LIKE 'video/%')"

export const facetsAvailable = (env: Pick<DamBindings, 'TYPESAFE_API_KEY'>) => !!env.TYPESAFE_API_KEY

/**
 * Queue photos for facets: those given, or every photo never asked or failed. Only photos with a preview or
 * thumbnail; the rest wait for one. Returns how many were queued.
 */
export async function queueFacets(db: D1Database, ids: string[] | 'unasked'): Promise<number> {
  const which = ids === 'unasked' ? "(facet_status IS NULL OR facet_status = 'failed')" : 'id IN (SELECT value FROM json_each(?))'
  const result = await db
    .prepare(
      `UPDATE assets SET facet_status = 'queued', facet_attempts = 0, facet_error = NULL
       WHERE ${which} AND ${ASKABLE} AND (facet_status IS NULL OR facet_status IN ('failed', 'done', 'skipped'))
         AND EXISTS (SELECT 1 FROM renditions r WHERE r.asset_id = assets.id AND r.name IN ('preview', 'thumb'))`,
    )
    .bind(...(ids === 'unasked' ? [] : [JSON.stringify(ids)]))
    .run()
  return result.meta.changes
}

/** Claim up to `limit` queued photos, oldest first. */
export async function claimFacets(db: D1Database, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `UPDATE assets SET facet_status = 'running', facet_started_at = ?, facet_attempts = facet_attempts + 1
       WHERE id IN (SELECT id FROM assets WHERE facet_status = 'queued' AND ${ASKABLE} ORDER BY created_at LIMIT ?) AND facet_status = 'queued'
       RETURNING id`,
    )
    .bind(nowIso(), limit)
    .all<{ id: string }>()
  return results.map((r) => r.id)
}

/** `facet_people` from Jev's answer: 'some' when it's sure there's a person but not how many. */
export function peopleValue(result: Pick<FacetResult, 'people' | 'tags'>): string | null {
  return result.people ?? (result.tags.includes('person') ? 'some' : null)
}

/**
 * Ask Jev about one claimed photo and store the answer. Whatever goes wrong, the photo leaves 'running': 'done',
 * 'skipped' (too small, refused, or nothing to send), 'failed' (asked again later), or back to null (no preview yet).
 */
export async function facetAsset(env: DamBindings, assetId: string, options: { fetch?: typeof fetch } = {}): Promise<'done' | 'failed' | 'skipped'> {
  const db = env.DB
  const set = (sql: string, ...values: unknown[]) => db.prepare(`UPDATE assets SET ${sql} WHERE id = ?`).bind(...values, assetId).run()
  try {
    if (!env.TYPESAFE_API_KEY) {
      await set("facet_status = 'queued', facet_attempts = facet_attempts - 1")
      return 'skipped'
    }
    // The size the model image will be, from the rendition it's made from.
    const rendition = await db
      .prepare("SELECT width, height FROM renditions WHERE asset_id = ? AND name IN ('preview', 'thumb') ORDER BY name = 'preview' DESC LIMIT 1")
      .bind(assetId)
      .first<{ width: number | null; height: number | null }>()
    if (!rendition) {
      await set("facet_status = NULL, facet_error = 'No preview yet.'")
      return 'skipped'
    }
    if (rendition.width && rendition.height) {
      const scale = Math.min(1, MODEL_SIDE / Math.max(rendition.width, rendition.height))
      if (Math.min(rendition.width, rendition.height) * scale < MIN_SIDE) {
        await set("facet_status = 'skipped', facet_error = ?, facet_at = ?", `Smaller than ${MIN_SIDE} px on a side.`, nowIso())
        return 'skipped'
      }
    }
    const image = await modelImage(env, assetId)
    if (!image) {
      await set("facet_status = NULL, facet_error = 'No preview yet.'")
      return 'skipped'
    }
    const ask = typesafe({ apiKey: env.TYPESAFE_API_KEY, fetch: options.fetch })
    const result = await classifyImage({ data_base64: image.slice(image.indexOf(',') + 1), format: 'jpg' }, ask)
    await set(
      `facet_status = 'done', facet_at = ?, facet_error = ?, facet_people = ?, facet_setting = ?, facet_medium = ?,
         facet_tags = ?, facet_scores = ?`,
      nowIso(),
      result.missing.length > 0 ? `No usable answer for: ${result.missing.join(', ')}` : null,
      peopleValue(result),
      result.setting,
      result.medium,
      JSON.stringify(result.tags),
      JSON.stringify(result.scores),
    )
    return 'done'
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : 'The facets call failed.'
    if (error instanceof TypeSafeRefused) {
      await set("facet_status = 'skipped', facet_error = ?, facet_at = ?", reason, nowIso()).catch(() => {})
      return 'skipped'
    }
    console.warn('[facets] failed', assetId, error)
    // 'failed' with the time: the sweep asks again after FACET_RETRY_MS while tries are left.
    await set("facet_status = 'failed', facet_error = ?, facet_at = ?", reason, nowIso()).catch(() => {})
    return 'failed'
  }
}

/**
 * The sweep's part, one query when there's nothing to do: put back failed photos whose pause is over and photos a
 * dead run left 'running', and say whether the queue should be nudged (work waiting, nothing running).
 */
export async function facetsSweep(db: D1Database, now = Date.now()): Promise<{ requeued: number; nudge: number }> {
  const retryBefore = new Date(now - FACET_RETRY_MS).toISOString()
  const staleBefore = new Date(now - FACET_RUNNING_STALE_MS).toISOString()
  const look = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM assets WHERE facet_status = 'failed' AND facet_attempts < ?1 AND facet_at < ?2 AND ${ASKABLE}) AS retry,
              EXISTS (SELECT 1 FROM assets WHERE facet_status = 'running' AND facet_started_at < ?3) AS stale,
              EXISTS (SELECT 1 FROM assets WHERE facet_status = 'running' AND facet_started_at >= ?3) AS moving,
              (SELECT COUNT(*) FROM (SELECT 1 FROM assets WHERE facet_status = 'queued' AND ${ASKABLE} LIMIT 100)) AS waiting`,
    )
    .bind(FACET_MAX_ATTEMPTS, retryBefore, staleBefore)
    .first<{ retry: number; stale: number; moving: number; waiting: number }>()
  if (!look) return { requeued: 0, nudge: 0 }
  let requeued = 0
  if (look.retry || look.stale) {
    const result = await db
      .prepare(
        `UPDATE assets SET facet_status = CASE WHEN facet_attempts < ?1 THEN 'queued' ELSE 'failed' END,
           facet_error = CASE WHEN facet_attempts < ?1 THEN facet_error ELSE COALESCE(facet_error, 'Not finished after ${FACET_MAX_ATTEMPTS} tries.') END,
           facet_at = CASE WHEN facet_status = 'running' THEN ?4 ELSE facet_at END
         WHERE (facet_status = 'failed' AND facet_attempts < ?1 AND facet_at < ?2 AND ${ASKABLE}) OR (facet_status = 'running' AND facet_started_at < ?3)`,
      )
      .bind(FACET_MAX_ATTEMPTS, retryBefore, staleBefore, new Date(now).toISOString())
      .run()
    requeued = result.meta.changes
  }
  const waiting = look.waiting + requeued
  return { requeued, nudge: !look.moving && waiting > 0 ? waiting : 0 }
}

export interface FacetStats {
  available: boolean
  done: number
  waiting: number
  failed: number
  skipped: number
  /** Photos never asked (or that had no preview yet), the "Find people" button's count. */
  unasked: number
  withPeople: number
}

export async function facetStats(env: DamBindings): Promise<FacetStats> {
  const row = await env.DB.prepare(
    `SELECT COUNT(CASE WHEN facet_status = 'done' THEN 1 END) AS done,
            COUNT(CASE WHEN facet_status IN ('queued', 'running') THEN 1 END) AS waiting,
            COUNT(CASE WHEN facet_status = 'failed' THEN 1 END) AS failed,
            COUNT(CASE WHEN facet_status = 'skipped' THEN 1 END) AS skipped,
            COUNT(CASE WHEN facet_status IS NULL AND EXISTS (SELECT 1 FROM renditions r WHERE r.asset_id = assets.id AND r.name IN ('preview', 'thumb')) THEN 1 END) AS unasked,
            COUNT(CASE WHEN facet_people IS NOT NULL AND facet_people != 'none' THEN 1 END) AS withPeople
     FROM assets WHERE ${ASKABLE}`,
  ).first<Omit<FacetStats, 'available'>>()
  return { available: facetsAvailable(env), done: 0, waiting: 0, failed: 0, skipped: 0, unasked: 0, withPeople: 0, ...row }
}
