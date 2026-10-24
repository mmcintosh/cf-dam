/**
 * The fast lane for background work (Cloudflare Queues), beside the sweep's once a minute.
 *
 * A message doesn't name a photo; it says "there is work of this kind waiting". Whoever takes it
 * claims a few waiting photos, as the sweep would (the same atomic claim, so no photo is worked on
 * twice), does them, and sends the message on while more are waiting. A few such chains run side by
 * side. That keeps the queue's operations to one message per handful of photos (the free plan allows
 * 10,000 a day), and nothing depends on a message arriving: the work is marked in the catalog
 * (`status = 'queued'`, `ai_status = 'queued'`), and if a message is lost, fails or can't be sent, the
 * sweep takes the photo within a minute, as it always has.
 *
 * Without the WORK binding, everything waits for the sweep.
 */
import type { DamBindings } from '../env'
import { nowIso } from '../lib/time'
import { aiAvailable, analyzeAsset } from './ai'
import { archiveOne } from './archive-jobs'
import { claimFacets, facetAsset, facetsOn } from './jev-facets'
import { askRestores } from './job-storage'
import { processAsset } from './process'

export type WorkKind = 'ai' | 'process' | 'restore' | 'archive' | 'facets'
export interface WorkMessage {
  kind: WorkKind
}

/** Photos one message takes: a few model calls' time, well inside one invocation's limits. */
export const CLAIM = { ai: 8, process: 4, restore: 20, archive: 1, facets: 8 } as const
/** Model calls at once within one message. */
const AI_PARALLEL = 4
/** Chains started for a lot of waiting work; each carries on until nothing is left. */
export const MAX_CHAINS = 4
/**
 * Archive copies hold a 16 MiB part each and run for minutes: two at most, so imports and AI keep moving. Facets
 * (an outside service whose rate limits we don't know) one chain; the consumer's concurrency is shared by all kinds.
 */
const KIND_CHAINS: Partial<Record<WorkKind, number>> = { archive: 2, facets: 1 }

/**
 * Say that work of this kind is waiting: one chain per CLAIM photos, at most MAX_CHAINS. Best effort:
 * a message that can't be sent (no binding, the day's operations used up) leaves it to the sweep.
 */
export async function nudge(env: DamBindings, kind: WorkKind, waiting = 1): Promise<void> {
  if (!env.WORK || waiting <= 0) return
  const chains = Math.min(KIND_CHAINS[kind] ?? MAX_CHAINS, Math.ceil(waiting / CLAIM[kind]))
  try {
    await env.WORK.sendBatch(Array.from({ length: chains }, () => ({ body: { kind } satisfies WorkMessage })))
  } catch (error) {
    console.warn('[work] could not send; the sweep will do it', kind, error)
  }
}

/** Claim up to `limit` photos waiting for AI review, as the sweep does. */
async function claimAi(db: D1Database, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `UPDATE assets SET ai_status = 'running', ai_started_at = ?, ai_attempts = ai_attempts + 1
       WHERE id IN (SELECT id FROM assets WHERE ai_status = 'queued' AND deleted_at IS NULL ORDER BY created_at LIMIT ?) AND ai_status = 'queued'
       RETURNING id`,
    )
    .bind(nowIso(), limit)
    .all<{ id: string }>()
  return results.map((r) => r.id)
}

/** Claim up to `limit` imported files waiting to be processed, as the sweep does. */
async function claimProcess(db: D1Database, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `UPDATE assets SET status = 'processing', updated_at = ?
       WHERE id IN (SELECT id FROM assets WHERE status = 'queued' AND deleted_at IS NULL ORDER BY created_at LIMIT ?) AND status = 'queued'
       RETURNING id`,
    )
    .bind(nowIso(), limit)
    .all<{ id: string }>()
  return results.map((r) => r.id)
}

/** Run `work` over `items`, `parallel` at a time. */
async function inBatches<T>(items: T[], parallel: number, work: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += parallel) await Promise.all(items.slice(i, i + parallel).map(work))
}

/** One message's work. Returns how many photos it did. */
export async function doWork(env: DamBindings, kind: WorkKind): Promise<number> {
  if (kind === 'ai') {
    // Switched off since the message was sent: what's queued waits, as it would for the sweep.
    if (!(await aiAvailable(env))) return 0
    const ids = await claimAi(env.DB, CLAIM.ai)
    await inBatches(ids, AI_PARALLEL, (id) => analyzeAsset(env, id))
    // A full hand means more may be waiting: carry on.
    if (ids.length === CLAIM.ai) await nudge(env, 'ai')
    return ids.length
  }
  if (kind === 'facets') {
    // TypeSafe's Jev, four at a time (jev-facets.ts). A hand with a failure stops the chain: the sweep asks again
    // after a pause, rather than this chain spending every try at once in an outage.
    if (!(await facetsOn(env))) return 0
    const ids = await claimFacets(env.DB, CLAIM.facets)
    const outcomes: string[] = []
    await inBatches(ids, AI_PARALLEL, async (id) => outcomes.push(await facetAsset(env, id)))
    if (ids.length === CLAIM.facets && !outcomes.includes('failed')) await nudge(env, 'facets')
    return ids.length
  }
  if (kind === 'archive') {
    // One original copied (or carried on) per message (archive-jobs.ts).
    const result = await archiveOne(env)
    if (result !== 'none') await nudge(env, 'archive')
    return result === 'none' ? 0 : 1
  }
  if (kind === 'restore') {
    // A job restore's photos, asked of S3 a handful at a time (job-storage.ts).
    const asked = await askRestores(env, CLAIM.restore)
    if (asked === CLAIM.restore) await nudge(env, 'restore')
    return asked
  }
  const ids = await claimProcess(env.DB, CLAIM.process)
  for (const id of ids) await processAsset(env, id)
  if (ids.length === CLAIM.process) await nudge(env, 'process')
  return ids.length
}

/**
 * The queue consumer. Each message is acknowledged once its work is done or has failed: a failure is
 * recorded on the photo (ai_error, a photo left 'processing'), and the sweep's own recovery takes it
 * from there, so a retried message would only find nothing to claim.
 */
export async function handleWork(env: DamBindings, batch: MessageBatch<WorkMessage>): Promise<void> {
  for (const message of batch.messages) {
    const kind = message.body?.kind
    if (kind !== 'ai' && kind !== 'process' && kind !== 'restore' && kind !== 'archive' && kind !== 'facets') {
      message.ack()
      continue
    }
    try {
      await doWork(env, kind)
    } catch (error) {
      console.warn('[work] failed', kind, error)
    }
    message.ack()
  }
}
