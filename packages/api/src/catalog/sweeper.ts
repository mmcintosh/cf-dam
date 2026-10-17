/**
 * The scheduled sweep (cron, every minute): background work that can't happen inside a request.
 *
 *  1. Process queued assets (imports): metadata and previews, a few per run, inside a time budget.
 *  2. Repair the search index, and run queued AI review (in parallel, within a budget).
 *  3. Fingerprint photos that have no look-alike hash yet (older uploads).
 *  4. Check archived originals with a restore in progress, and mark them restored when ready.
 */
import type { DamBindings } from '../env'
import { nowIso } from '../lib/time'
import { getConnection, providerFor } from '../storage/connections'
import { ARCHIVE_CLASSES } from '../storage/types'
import { aiAvailable, analyzeAsset } from './ai'
import { hashFromThumbnail, recordHash } from './phash'
import { processAsset } from './process'
import { fillPlacesFromGps } from './places'
import { indexAsset, unindexed } from './search'

const PROCESS_BUDGET_MS = 20_000
const MAX_PER_RUN = 25
const AI_BUDGET_MS = 40_000
const AI_CONCURRENCY = 4
const RESTORE_CHECKS_PER_RUN = 50

export interface SweepResult {
  indexed: number
  placed: number
  analysed: number
  hashed: number
  processed: number
  restoresChecked: number
  restored: number
}

export async function runSweep(env: DamBindings): Promise<SweepResult> {
  const result: SweepResult = { indexed: 0, placed: 0, analysed: 0, hashed: 0, processed: 0, restoresChecked: 0, restored: 0 }
  const started = Date.now()

  const { results: queued } = await env.DB.prepare(
    "SELECT id FROM assets WHERE status = 'queued' AND deleted_at IS NULL ORDER BY created_at LIMIT ?",
  )
    .bind(MAX_PER_RUN)
    .all<{ id: string }>()
  for (const { id } of queued) {
    if (Date.now() - started > PROCESS_BUDGET_MS) break
    // Claim it, so an overlapping run doesn't process the same asset.
    const claimed = await env.DB.prepare("UPDATE assets SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'queued'")
      .bind(nowIso(), id)
      .run()
    if (claimed.meta.changes === 0) continue
    await processAsset(env, id)
    result.processed++
  }

  // Repair the search index (after a rebuild, or a write that failed).
  for (const id of await unindexed(env.DB, 200)) {
    if (Date.now() - started > PROCESS_BUDGET_MS) break
    await indexAsset(env.DB, id)
    result.indexed++
  }

  // City and country from GPS for photos that have never been looked up.
  const { results: unplaced } = await env.DB.prepare(
    'SELECT id FROM assets WHERE gps_lat IS NOT NULL AND place_checked_at IS NULL AND deleted_at IS NULL LIMIT 500',
  ).all<{ id: string }>()
  if (unplaced.length > 0) {
    result.placed = await fillPlacesFromGps(env, unplaced.map((r) => r.id))
    for (const { id } of unplaced) await indexAsset(env.DB, id)
  }

  // AI review, a few at a time in parallel: each call waits seconds on the model, not on CPU.
  if (await aiAvailable(env)) {
    const deadline = started + AI_BUDGET_MS
    while (Date.now() < deadline) {
      const { results: batch } = await env.DB.prepare("SELECT id FROM assets WHERE ai_status = 'queued' AND deleted_at IS NULL ORDER BY created_at LIMIT ?")
        .bind(AI_CONCURRENCY)
        .all<{ id: string }>()
      if (batch.length === 0) break
      // Claim the batch so an overlapping run doesn't analyse the same photos.
      const claimed: string[] = []
      for (const { id } of batch) {
        const r = await env.DB.prepare("UPDATE assets SET ai_status = 'running', ai_started_at = ? WHERE id = ? AND ai_status = 'queued'").bind(nowIso(), id).run()
        if (r.meta.changes > 0) claimed.push(id)
      }
      const outcomes = await Promise.all(claimed.map((id) => analyzeAsset(env, id)))
      result.analysed += outcomes.filter((o) => o === 'done').length
    }
    // A run that died mid-analysis leaves 'running' behind; give those another go.
    await env.DB.prepare("UPDATE assets SET ai_status = 'queued' WHERE ai_status = 'running' AND ai_started_at < ?")
      .bind(new Date(Date.now() - 10 * 60_000).toISOString())
      .run()
  }

  // Backfill look-alike fingerprints for assets that have a thumbnail but no hash yet.
  const { results: unhashed } = await env.DB.prepare(
    `SELECT a.id FROM assets a JOIN renditions r ON r.asset_id = a.id AND r.name = 'thumb'
     WHERE a.phash IS NULL AND a.deleted_at IS NULL AND a.status = 'ready' AND (a.phash_tried_at IS NULL OR a.phash_tried_at < ?)
     ORDER BY a.phash_tried_at IS NOT NULL, a.phash_tried_at LIMIT 50`,
  )
    // A thumbnail that couldn't be hashed is tried again a day later, not every minute.
    .bind(new Date(Date.now() - 86_400_000).toISOString())
    .all<{ id: string }>()
  for (const { id } of unhashed) {
    if (Date.now() - started > PROCESS_BUDGET_MS) break
    const hash = await hashFromThumbnail(env, id).catch((error) => {
      console.warn('[sweep] could not hash', id, error)
      return null
    })
    if (!hash) {
      await env.DB.prepare('UPDATE assets SET phash_tried_at = ? WHERE id = ?').bind(nowIso(), id).run()
      continue
    }
    await recordHash(env.DB, id, hash)
    result.hashed++
  }

  const { results: restoring } = await env.DB.prepare(
    "SELECT asset_id, connection_id, key FROM asset_locations WHERE state = 'restoring' ORDER BY updated_at LIMIT ?",
  )
    .bind(RESTORE_CHECKS_PER_RUN)
    .all<{ asset_id: string; connection_id: string; key: string }>()
  for (const location of restoring) {
    const connection = await getConnection(env.DB, location.connection_id)
    if (!connection) continue
    try {
      const head = await providerFor(env, connection).head(location.key)
      result.restoresChecked++
      if (head && ARCHIVE_CLASSES.has(head.storageClass) && head.restore && !head.restore.ongoing && head.restore.expiresAt) {
        await env.DB.prepare("UPDATE asset_locations SET state = 'restored', restore_expires_at = ?, updated_at = ? WHERE asset_id = ? AND connection_id = ?")
          .bind(head.restore.expiresAt, nowIso(), location.asset_id, location.connection_id)
          .run()
        await indexAsset(env.DB, location.asset_id)
        result.restored++
      }
    } catch (error) {
      console.warn('[sweep] restore check failed', location.asset_id, error)
    }
  }

  return result
}
