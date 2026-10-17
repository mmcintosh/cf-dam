/**
 * The scheduled sweep (cron, every minute): background work that can't happen inside a request.
 *
 *  1. Process queued assets (imports): metadata and previews, a few per run, inside a time budget.
 *  2. Fingerprint photos that have no look-alike hash yet (older uploads).
 *  3. Check archived originals with a restore in progress, and mark them restored when ready.
 */
import type { DamBindings } from '../env'
import { nowIso } from '../lib/time'
import { getConnection, providerFor } from '../storage/connections'
import { ARCHIVE_CLASSES } from '../storage/types'
import { hashFromThumbnail, recordHash } from './phash'
import { processAsset } from './process'
import { indexAsset } from './search'

const PROCESS_BUDGET_MS = 20_000
const MAX_PER_RUN = 25
const RESTORE_CHECKS_PER_RUN = 50

export interface SweepResult {
  hashed: number
  processed: number
  restoresChecked: number
  restored: number
}

export async function runSweep(env: DamBindings): Promise<SweepResult> {
  const result: SweepResult = { hashed: 0, processed: 0, restoresChecked: 0, restored: 0 }
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

  // Backfill look-alike fingerprints for assets that have a thumbnail but no hash yet.
  const { results: unhashed } = await env.DB.prepare(
    `SELECT a.id FROM assets a JOIN renditions r ON r.asset_id = a.id AND r.name = 'thumb'
     WHERE a.phash IS NULL AND a.deleted_at IS NULL AND a.status = 'ready' LIMIT 50`,
  ).all<{ id: string }>()
  for (const { id } of unhashed) {
    if (Date.now() - started > PROCESS_BUDGET_MS) break
    const hash = await hashFromThumbnail(env, id).catch(() => null)
    if (!hash) continue
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
