/**
 * The scheduled sweep (cron, every minute): background work that can't happen inside a request.
 *
 *  1. Process queued assets (imports): metadata and previews, a few per run; and pick up assets left
 *     in 'processing' by a request or run that died part-way.
 *  2. Repair the search index, and fill in places from GPS.
 *  3. Run queued AI review (in parallel).
 *  4. Fingerprint photos that have no look-alike hash yet (older uploads), and give photos a helper
 *     indexed before 0036 their quick fingerprint for exact duplicates.
 *  5. Check archived originals with a restore in progress, and mark them restored when ready.
 *  6. Drop gallery images nobody will be shown again (made with an old watermark or a replaced preview).
 *  7. Check originals are still in their stores, unchanged (catalog/checks.ts).
 *  8. Back up the catalog daily, a part per run, and delete old backups (catalog/backups.ts).
 *  9. Rebuild the whole-archive numbers (facets, timeline, keyword and duplicate counts) a slice at
 *     a time, every ten minutes (catalog/stats.ts).
 * 10. Make missing previews again: check R2 for them when asked to, and remake the Worker's share
 *     (catalog/previews.ts).
 * 11. Every five minutes, look for problems that need a person, and open or resolve alerts
 *     (catalog/alerts.ts). A stage that fails opens its own alert as it happens.
 *
 * While a backup is being restored into a fresh install (catalog/restore.ts), the sweep does only
 * that, with the whole run; before anyone has an account, it makes no backups.
 *
 * Each stage has its own slice of time and of the invocation's D1 queries, so a busy one (an AI
 * backlog, a large import) can't starve the others; what a stage doesn't reach waits for the next run.
 */
import { setupNeeded } from '../auth/setup-state'
import type { DamBindings } from '../env'
import { logActivity } from '../lib/activity'
import { countQueries, QUERIES_PER_INVOCATION } from '../lib/query-budget'
import { nowIso } from '../lib/time'
import { sweepShot } from './jobs'
import { archiveStep, jobsLook } from './archive-jobs'
import { recoverRestoreItems } from './job-storage'
import { nudge } from './work'
import { getConnection, providerFor } from '../storage/connections'
import { ARCHIVE_CLASSES } from '../storage/types'
import { AI_MAX_ATTEMPTS, AI_RUNNING_STALE_MS, aiAvailable, analyzeAsset } from './ai'
import { alertsDue, checkAlerts, noteSweepFailure } from './alerts'
import { abandonStaleArchiveUploads } from './archive'
import { checkStep, remakeStep } from './previews'
import { backupStep } from './backups'
import { currentRestore, restoreStep, type RestoreStatus } from './restore'
import { checkStorage } from './checks'
import { statsStep } from './stats'
import { hashFromThumbnail, recordHashes } from './phash'
import { fillQuickHashes } from './duplicates'
import { finishAsset, processAsset } from './process'
import { fillPlacesFromGps, placeIndex } from './places'
import { indexAssets, unindexed } from './search'
import { meaningStep } from './meaning'
import { pruneGalleryCache } from './watermark'

/** Each stage's slice: milliseconds, and round trips to D1 (of the invocation's 1,000). */
export const SLICES = {
  process: { ms: 15_000, queries: 245 },
  recover: { ms: 5_000, queries: 60 },
  index: { ms: 5_000, queries: 60 },
  places: { ms: 3_000, queries: 20 },
  ai: { ms: 25_000, queries: 180 },
  meaning: { ms: 5_000, queries: 10 },
  hash: { ms: 8_000, queries: 100 },
  restores: { ms: 5_000, queries: 60 },
  gallery: { ms: 3_000, queries: 10 },
  checks: { ms: 8_000, queries: 20 },
  backup: { ms: 10_000, queries: 40 },
  stats: { ms: 10_000, queries: 30 },
  previews: { ms: 10_000, queries: 40 },
  alerts: { ms: 3_000, queries: 10 },
  jobs: { ms: 5_000, queries: 15 },
} satisfies Record<string, { ms: number; queries: number }>
// Headroom for the queries a stage starts before it sees its slice is used up.
const SLICED = Object.values(SLICES).reduce((n, s) => n + s.queries, 0)
if (SLICED > QUERIES_PER_INVOCATION * 0.9) throw new Error('The sweep\'s query slices leave no headroom.')

/** A restore's share of a run, which it has to itself. */
const RESTORE_SLICE = { ms: 25_000, queries: 800 }
/** Assets a run may process: each takes a few dozen queries. */
const MAX_PER_RUN = 25
const AI_CONCURRENCY = 4
const RESTORE_CHECKS_PER_RUN = 50
/** How long until a restore that isn't ready is looked at again. */
const RESTORE_CHECK_MS = 20 * 60_000
/** Nothing takes this long in 'processing'; an asset still there was abandoned. */
const STALE_PROCESSING_MS = 60 * 60_000

export interface SweepResult {
  indexed: number
  placed: number
  meant: number
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
  alerts: { opened: number; resolved: number } | null
  restore: { rows: number; status: RestoreStatus } | null
  previews: { checking: boolean; remade: number }
}

export async function runSweep(bindings: DamBindings, slices: typeof SLICES = SLICES): Promise<SweepResult> {
  const result: SweepResult = { indexed: 0, placed: 0, meant: 0, analysed: 0, hashed: 0, processed: 0, restoresChecked: 0, restored: 0, recovered: 0, pruned: 0, checked: 0, checkProblems: 0, backup: { started: null, finished: null, pruned: 0 }, statsPublished: false, alerts: null, restore: null, previews: { checking: false, remade: 0 } }
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

  // A restore under way has the run to itself: the rest would work on half a catalog. (Set up, which
  // is almost always, costs no query: it's remembered.)
  const settingUp = await setupNeeded(db)
  if (settingUp) {
    const restoring = await currentRestore(db)
    if (restoring) {
      if (restoring.status === 'running') {
        const until = Date.now() + RESTORE_SLICE.ms
        const before = budget.used()
        result.restore = await restoreStep(env, () => Date.now() < until && budget.used() - before < RESTORE_SLICE.queries)
      }
      return result
    }
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
        await noteSweepFailure(db, 'recover', error)
        // Try again in an hour, not every minute.
        await db.prepare('UPDATE assets SET updated_at = ? WHERE id = ?').bind(nowIso(), id).run()
      })
    } else {
      await db.prepare("UPDATE assets SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'processing'").bind(nowIso(), id).run()
    }
    result.recovered++
  }
  // Archive uploads an agent never finished: given up after a week (the bucket's own rule backs this
  // up). Once an hour is plenty, and keeps a quiet minute's queries down.
  if (recovering.more() && new Date().getUTCMinutes() === 0) {
    await abandonStaleArchiveUploads(env).catch(async (error) => {
      console.warn('[sweep] archive clean-up failed', error)
      await noteSweepFailure(db, 'archive', error)
    })
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

  // Search by meaning: vectors for photos whose words changed (catalog/meaning.ts).
  const meaning = slice('meaning')
  if (meaning.more()) {
    result.meant = await meaningStep(env, meaning.more).catch(async (error) => {
      await noteSweepFailure(db, 'meaning', error)
      return 0
    })
  }

  // 4. Look-alike fingerprints for assets that have a thumbnail but no hash yet.
  const hashing = slice('hash')
  if (hashing.more()) {
    const [toHash, fill] = await db.batch([
      db
        .prepare(
          `SELECT a.id FROM assets a JOIN renditions r ON r.asset_id = a.id AND r.name = 'thumb'
           WHERE a.phash IS NULL AND a.deleted_at IS NULL AND a.status = 'ready' AND (a.phash_tried_at IS NULL OR a.phash_tried_at < ?)
           ORDER BY a.phash_tried_at IS NOT NULL, a.phash_tried_at LIMIT 50`,
        )
        // A thumbnail that couldn't be hashed is tried again a day later, not every minute.
        .bind(new Date(Date.now() - 86_400_000).toISOString()),
      db.prepare("SELECT value FROM settings WHERE key = 'quick_hash.fill'"),
    ])
    const unhashed = toHash!.results as { id: string }[]
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
    // Exact-duplicate fingerprints for photos a helper indexed before 0036 (until they're all done).
    const filling = (fill!.results[0] as { value: string } | undefined)?.value
    if (filling !== undefined && hashing.more()) await fillQuickHashes(db, hashing.more, filling)
  }

  // 5. Archived originals being restored: ready yet? Each is looked at when its next check comes (20 minutes
  // apart), so a long restore doesn't hold up the others; restored copies whose time is up are cold again.
  const restoring = slice('restores')
  if (restoring.more()) {
    const now = nowIso()
    // One look at what there is to do, so a quiet minute costs one query.
    const todo = (await db
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM asset_locations WHERE state = 'restored' AND restore_expires_at <= ?1) AS expired,
           EXISTS (SELECT 1 FROM asset_locations WHERE state = 'restoring' AND (next_check_at IS NULL OR next_check_at <= ?1)) AS due,
           EXISTS (SELECT 1 FROM restore_items WHERE state IN ('waiting', 'asking')) AS items`,
      )
      .bind(now)
      .first<{ expired: number; due: number; items: number }>())!
    if (todo.expired) {
      await db.prepare("UPDATE asset_locations SET state = 'archived', restore_expires_at = NULL, updated_at = ? WHERE state = 'restored' AND restore_expires_at <= ?")
        .bind(now, now)
        .run()
    }
    // Job restores (job-storage.ts) are asked of S3 by the work queue; if a message was lost, nudge it again.
    if (todo.items) {
      const waiting = await recoverRestoreItems(db)
      if (waiting > 0) await nudge(env, 'restore', waiting)
    }
    const { results: locations } = !todo.due ? { results: [] } : await db
      .prepare(
        `SELECT asset_id, connection_id, key FROM asset_locations
         WHERE state = 'restoring' AND (next_check_at IS NULL OR next_check_at <= ?) ORDER BY next_check_at LIMIT ?`,
      )
      .bind(now, RESTORE_CHECKS_PER_RUN)
      .all<{ asset_id: string; connection_id: string; key: string }>()
    const connections = new Map<string, Awaited<ReturnType<typeof getConnection>>>()
    const restored: string[] = []
    const later = new Date(Date.now() + RESTORE_CHECK_MS).toISOString()
    for (const location of locations) {
      if (!restoring.more()) break
      if (!connections.has(location.connection_id)) connections.set(location.connection_id, await getConnection(db, location.connection_id))
      const connection = connections.get(location.connection_id)
      const set = (state: string, fields: { expires?: string | null; storageClass?: string; next?: string | null }) =>
        db
          .prepare('UPDATE asset_locations SET state = ?, restore_expires_at = ?, storage_class = COALESCE(?, storage_class), next_check_at = ?, updated_at = ? WHERE asset_id = ? AND connection_id = ?')
          .bind(state, fields.expires ?? null, fields.storageClass ?? null, fields.next ?? null, nowIso(), location.asset_id, location.connection_id)
          .run()
      try {
        if (!connection) {
          await set('gone', {})
          continue
        }
        const head = await providerFor(env, connection).head(location.key)
        result.restoresChecked++
        if (!head) await set('gone', {})
        else if (!ARCHIVE_CLASSES.has(head.storageClass)) await set('present', { storageClass: head.storageClass })
        else if (head.restore && !head.restore.ongoing && head.restore.expiresAt) {
          await set('restored', { expires: head.restore.expiresAt })
          restored.push(location.asset_id)
          result.restored++
        } else await set('restoring', { next: later })
      } catch (error) {
        console.warn('[sweep] restore check failed', location.asset_id, error)
        await set('restoring', { next: later }).catch(() => {})
        await noteSweepFailure(db, 'restores', error)
      }
    }
    await indexAssets(db, restored)
  }

  // 6. Gallery images made with an old watermark or from a replaced preview.
  if (slice('gallery').more()) {
    result.pruned = await pruneGalleryCache(env).catch(async (error) => {
      console.warn('[sweep] gallery prune failed', error)
      await noteSweepFailure(db, 'gallery', error)
      return 0
    })
  }

  // 7. Originals still there and unchanged: a few each run, oldest check first.
  const checking = slice('checks')
  if (checking.more()) {
    const { checked, problems } = await checkStorage(env, checking.more).catch(async (error) => {
      console.warn('[sweep] storage checks failed', error)
      await noteSweepFailure(db, 'checks', error)
      return { checked: 0, problems: 0 }
    })
    result.checked = checked
    result.checkProblems = problems
  }

  // 8. The daily catalog backup, carried on a part at a time; old ones deleted when none is running.
  const backingUp = slice('backup')
  if (!settingUp && backingUp.more()) {
    const step = await backupStep(env, backingUp.more).catch(async (error) => {
      console.warn('[sweep] backup failed', error)
      await noteSweepFailure(db, 'backup', error)
      return null
    })
    if (step) result.backup = { started: step.started, finished: step.finished, pruned: step.pruned }
  }

  // 9. Whole-archive numbers, a slice at a time.
  const counting = slice('stats')
  if (counting.more()) {
    result.statsPublished = await statsStep(env, counting.more).catch(async (error) => {
      console.warn('[sweep] stats failed', error)
      await noteSweepFailure(db, 'stats', error)
      return false
    })
  }

  // 10. Missing previews: one look to see whether there's anything to do.
  const remaking = slice('previews')
  if (remaking.more()) {
    const todo = await db
      .prepare("SELECT EXISTS (SELECT 1 FROM settings WHERE key = 'previews.check') AS checking, EXISTS (SELECT 1 FROM preview_requests WHERE route IN ('agent', 'worker')) AS waiting")
      .first<{ checking: number; waiting: number }>()
    try {
      if (todo?.checking) result.previews.checking = await checkStep(env, remaking.more)
      if (todo?.waiting && remaking.more()) result.previews.remade = await remakeStep(env, remaking.more)
    } catch (error) {
      console.warn('[sweep] previews failed', error)
      await noteSweepFailure(db, 'previews', error)
    }
  }

  // 11. Jobs (jobs.ts, archive-jobs.ts): one look, then booked jobs whose shoot dates now have photos move to Shot,
  // and delivered jobs due for archiving get their originals listed for the work queue to copy.
  const working = slice('jobs')
  if (working.more()) {
    try {
      const todo = await jobsLook(db)
      if (todo.shot) {
        for (const job of await sweepShot(db)) {
          await logActivity(db, { userId: null, action: 'job.stage', targetType: 'job', targetId: job.id, details: { title: job.title, from: 'booked', to: 'shot', by: 'photos' } })
        }
      }
      if (working.more()) {
        const waiting = await archiveStep(env, working.more, todo)
        if (waiting > 0) await nudge(env, 'archive', waiting)
      }
    } catch (error) {
      console.warn('[sweep] jobs failed', error)
      await noteSweepFailure(db, 'jobs', error)
    }
  }

  // 12. Problems that need a person.
  if (slice('alerts').more() && alertsDue()) {
    result.alerts = await checkAlerts(env).catch(async (error) => {
      console.warn('[sweep] alerts failed', error)
      await noteSweepFailure(db, 'alerts', error)
      return null
    })
  }

  return result
}
