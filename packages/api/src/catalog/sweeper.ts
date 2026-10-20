/**
 * The scheduled sweep (cron, every minute): background work that can't happen inside a request.
 *
 *  1. Process queued assets (imports): metadata and previews, a few per run; and pick up assets left
 *     in 'processing' by a request or run that died part-way.
 *  2. Repair the search index, and fill in places from GPS.
 *  3. Run queued AI review (in parallel).
 *  4. Fingerprint photos that have no look-alike hash yet (older uploads).
 *  5. Check archived originals with a restore in progress, and mark them restored when ready.
 *  6. Drop gallery images nobody will be shown again (made with an old watermark or a replaced preview).
 *  7. Check originals are still in their stores, unchanged (catalog/checks.ts).
 *  8. Back up the catalog daily, a part per run, and delete old backups (catalog/backups.ts).
 *  9. Rebuild the whole-archive numbers (facets, timeline, keyword and duplicate counts) a slice at
 *     a time, every ten minutes (catalog/stats.ts).
 *
 * Each stage has its own slice of time and of the invocation's D1 queries, so a busy one (an AI
 * backlog, a large import) can't starve the others; what a stage doesn't reach waits for the next run.
 */
import type { DamBindings } from '../env'
import { countQueries, QUERIES_PER_INVOCATION } from '../lib/query-budget'
import { nowIso } from '../lib/time'
import { getConnection, providerFor } from '../storage/connections'
import { ARCHIVE_CLASSES } from '../storage/types'
import { AI_MAX_ATTEMPTS, AI_RUNNING_STALE_MS, aiAvailable, analyzeAsset } from './ai'
import { backupStep } from './backups'
import { checkStorage } from './checks'
import { statsStep } from './stats'
import { hashFromThumbnail, recordHashes } from './phash'
import { finishAsset, processAsset } from './process'
import { fillPlacesFromGps, placeIndex } from './places'
import { indexAssets, unindexed } from './search'
import { pruneGalleryCache } from './watermark'

/** Each stage's slice: milliseconds, and round trips to D1 (of the invocation's 1,000). */
export const SLICES = {
  process: { ms: 15_000, queries: 260 },
  recover: { ms: 5_000, queries: 60 },
  index: { ms: 5_000, queries: 60 },
  places: { ms: 3_000, queries: 20 },
  ai: { ms: 25_000, queries: 200 },
  hash: { ms: 8_000, queries: 100 },
  restores: { ms: 5_000, queries: 60 },
  gallery: { ms: 3_000, queries: 10 },
  checks: { ms: 8_000, queries: 20 },
  backup: { ms: 10_000, queries: 40 },
  stats: { ms: 10_000, queries: 30 },
} satisfies Record<string, { ms: number; queries: number }>
// Headroom for the queries a stage starts before it sees its slice is used up.
const SLICED = Object.values(SLICES).reduce((n, s) => n + s.queries, 0)
if (SLICED > QUERIES_PER_INVOCATION * 0.9) throw new Error('The sweep\'s query slices leave no headroom.')

/** Assets a run may process: each takes a few dozen queries. */
const MAX_PER_RUN = 25
const AI_CONCURRENCY = 4
const RESTORE_CHECKS_PER_RUN = 50
/** Nothing takes this long in 'processing'; an asset still there was abandoned. */
const STALE_PROCESSING_MS = 60 * 60_000

export interface SweepResult {
  indexed: number
  placed: number
  analysed: number
  hashed: number
  processed: number
  restoresChecked: number
  restored: number
  recovered: number
  pruned: number
  checked: number
  checkProblems: number
  backup: { started: string | null; finished: string | null; pruned: number }
  statsPublished: boolean
}

export async function runSweep(bindings: DamBindings, slices: typeof SLICES = SLICES): Promise<SweepResult> {
  const result: SweepResult = { indexed: 0, placed: 0, analysed: 0, hashed: 0, processed: 0, restoresChecked: 0, restored: 0, recovered: 0, pruned: 0, checked: 0, checkProblems: 0, backup: { started: null, finished: null, pruned: 0 }, statsPublished: false }
  const budget = countQueries(bindings.DB)
  const env: DamBindings = { ...bindings, DB: budget.db }
  const db = env.DB
  /** A stage's clock and query count start when it does; `more()` says whether it may start another item. */
  const slice = (name: keyof typeof SLICES) => {
    const { ms, queries } = slices[name]
    const until = Date.now() + ms
    const before = budget.used()
    return { more: () => Date.now() < until && budget.used() - before < queries, queriesLeft: () => queries - (budget.used() - before) }
  }

  // 1. Queued assets, oldest first, each claimed as it is taken so an overlapping run doesn't take it too.
  const processing = slice('process')
  for (let n = 0; n < MAX_PER_RUN && processing.more(); n++) {
    const claimed = await db
      .prepare(
        `UPDATE assets SET status = 'processing', updated_at = ?
         WHERE id = (SELECT id FROM assets WHERE status = 'queued' AND deleted_at IS NULL ORDER BY created_at LIMIT 1) AND status = 'queued'
         RETURNING id`,
      )
      .bind(nowIso())
      .first<{ id: string }>()
    if (!claimed) break
    await processAsset(env, claimed.id)
    result.processed++
  }

  // Abandoned in 'processing': an upload goes back in the queue. A NAS agent's file is finished with
  // whatever previews arrived; the agent re-sends the file (it records nothing until it is finished),
  // and missing previews are asked for then.
  const recovering = slice('recover')
  const { results: stuck } = await db
    .prepare(
      `SELECT a.id, EXISTS (SELECT 1 FROM asset_locations l WHERE l.asset_id = a.id AND l.storage_class = 'NAS') AS nas
       FROM assets a WHERE a.status = 'processing' AND a.updated_at < ? AND a.deleted_at IS NULL LIMIT 20`,
    )
    .bind(new Date(Date.now() - STALE_PROCESSING_MS).toISOString())
    .all<{ id: string; nas: number }>()
  for (const { id, nas } of stuck) {
    if (!recovering.more()) break
    if (nas) {
      await finishAsset(env, id, { queueAi: false }).catch(async (error) => {
        console.warn('[sweep] could not finish', id, error)
        // Try again in an hour, not every minute.
        await db.prepare('UPDATE assets SET updated_at = ? WHERE id = ?').bind(nowIso(), id).run()
      })
    } else {
      await db.prepare("UPDATE assets SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'processing'").bind(nowIso(), id).run()
    }
    result.recovered++
  }

  // 2. Repair the search index (after a rebuild, a keyword change, or a write that failed): three
  // round trips per 50 assets.
  const indexing = slice('index')
  while (indexing.more() && indexing.queriesLeft() > 4) {
    const ids = await unindexed(db, 50)
    if (ids.length === 0) break
    await indexAssets(db, ids)
    result.indexed += ids.length
  }

  // City and country from GPS for photos never looked up. Only when the place list loads: otherwise
  // the same photos would be read (and reindexed) every minute, for nothing.
  const placing = slice('places')
  if (placing.more() && (await placeIndex(env))) {
    const { results: unplaced } = await db
      .prepare('SELECT id FROM assets WHERE gps_lat IS NOT NULL AND place_checked_at IS NULL AND deleted_at IS NULL LIMIT 500')
      .all<{ id: string }>()
    const placed = await fillPlacesFromGps(env, unplaced.map((r) => r.id))
    result.placed = placed.length
    await indexAssets(db, placed)
  }

  // 3. AI review, a few at a time in parallel: each call waits seconds on the model, not on CPU.
  const reviewing = slice('ai')
  if (reviewing.more() && (await aiAvailable(env))) {
    while (reviewing.more()) {
      // Claim a few so an overlapping run doesn't analyse the same photos.
      const { results: claimed } = await db
        .prepare(
          `UPDATE assets SET ai_status = 'running', ai_started_at = ?, ai_attempts = ai_attempts + 1
           WHERE id IN (SELECT id FROM assets WHERE ai_status = 'queued' AND deleted_at IS NULL ORDER BY created_at LIMIT ?) AND ai_status = 'queued'
           RETURNING id`,
        )
        .bind(nowIso(), AI_CONCURRENCY)
        .all<{ id: string }>()
      if (claimed.length === 0) break
      const outcomes = await Promise.all(claimed.map(({ id }) => analyzeAsset(env, id)))
      result.analysed += outcomes.filter((o) => o === 'done').length
    }
    // A run that died mid-analysis leaves 'running' behind: another go while it has tries left.
    await db
      .prepare(
        `UPDATE assets SET ai_status = CASE WHEN ai_attempts < ? THEN 'queued' ELSE 'failed' END,
           ai_error = CASE WHEN ai_attempts < ? THEN ai_error ELSE 'The analysis didn’t finish, ${AI_MAX_ATTEMPTS} times.' END
         WHERE ai_status = 'running' AND ai_started_at < ?`,
      )
      .bind(AI_MAX_ATTEMPTS, AI_MAX_ATTEMPTS, new Date(Date.now() - AI_RUNNING_STALE_MS).toISOString())
      .run()
  }

  // 4. Look-alike fingerprints for assets that have a thumbnail but no hash yet.
  const hashing = slice('hash')
  if (hashing.more()) {
    const { results: unhashed } = await db
      .prepare(
        `SELECT a.id FROM assets a JOIN renditions r ON r.asset_id = a.id AND r.name = 'thumb'
         WHERE a.phash IS NULL AND a.deleted_at IS NULL AND a.status = 'ready' AND (a.phash_tried_at IS NULL OR a.phash_tried_at < ?)
         ORDER BY a.phash_tried_at IS NOT NULL, a.phash_tried_at LIMIT 50`,
      )
      // A thumbnail that couldn't be hashed is tried again a day later, not every minute.
      .bind(new Date(Date.now() - 86_400_000).toISOString())
      .all<{ id: string }>()
    const hashes: { id: string; hash: string }[] = []
    const failed: string[] = []
    for (const { id } of unhashed) {
      if (!hashing.more()) break
      const hash = await hashFromThumbnail(env, id).catch((error) => {
        console.warn('[sweep] could not hash', id, error)
        return null
      })
      if (hash) hashes.push({ id, hash })
      else failed.push(id)
    }
    if (failed.length > 0) await db.prepare('UPDATE assets SET phash_tried_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(nowIso(), JSON.stringify(failed)).run()
    await recordHashes(db, hashes)
    result.hashed = hashes.length
  }

  // 5. Archived originals being restored: ready yet?
  const restoring = slice('restores')
  if (restoring.more()) {
    const { results: locations } = await db
      .prepare("SELECT asset_id, connection_id, key FROM asset_locations WHERE state = 'restoring' ORDER BY updated_at LIMIT ?")
      .bind(RESTORE_CHECKS_PER_RUN)
      .all<{ asset_id: string; connection_id: string; key: string }>()
    const connections = new Map<string, Awaited<ReturnType<typeof getConnection>>>()
    const restored: string[] = []
    for (const location of locations) {
      if (!restoring.more()) break
      if (!connections.has(location.connection_id)) connections.set(location.connection_id, await getConnection(db, location.connection_id))
      const connection = connections.get(location.connection_id)
      if (!connection) continue
      try {
        const head = await providerFor(env, connection).head(location.key)
        result.restoresChecked++
        if (head && ARCHIVE_CLASSES.has(head.storageClass) && head.restore && !head.restore.ongoing && head.restore.expiresAt) {
          await db.prepare("UPDATE asset_locations SET state = 'restored', restore_expires_at = ?, updated_at = ? WHERE asset_id = ? AND connection_id = ?")
            .bind(head.restore.expiresAt, nowIso(), location.asset_id, location.connection_id)
            .run()
          restored.push(location.asset_id)
          result.restored++
        }
      } catch (error) {
        console.warn('[sweep] restore check failed', location.asset_id, error)
      }
    }
    await indexAssets(db, restored)
  }

  // 6. Gallery images made with an old watermark or from a replaced preview.
  if (slice('gallery').more()) {
    result.pruned = await pruneGalleryCache(env).catch((error) => {
      console.warn('[sweep] gallery prune failed', error)
      return 0
    })
  }

  // 7. Originals still there and unchanged: a few each run, oldest check first.
  const checking = slice('checks')
  if (checking.more()) {
    const { checked, problems } = await checkStorage(env, checking.more).catch((error) => {
      console.warn('[sweep] storage checks failed', error)
      return { checked: 0, problems: 0 }
    })
    result.checked = checked
    result.checkProblems = problems
  }

  // 8. The daily catalog backup, carried on a part at a time; old ones deleted when none is running.
  const backingUp = slice('backup')
  if (backingUp.more()) {
    const step = await backupStep(env, backingUp.more).catch((error) => {
      console.warn('[sweep] backup failed', error)
      return null
    })
    if (step) result.backup = { started: step.started, finished: step.finished, pruned: step.pruned }
  }

  // 9. Whole-archive numbers, a slice at a time.
  const counting = slice('stats')
  if (counting.more()) {
    result.statsPublished = await statsStep(env, counting.more).catch((error) => {
      console.warn('[sweep] stats failed', error)
      return false
    })
  }

  return result
}
