/**
 * Storage checks (plans/PLAN-S-v1.md, slice S1): is each original still where the catalog says, and
 * still the same file?
 *
 * Every location outside a NAS (the agent watches those) is asked about once a cycle, oldest check
 * first: the store must still have it, at the recorded size and etag, and with the photo's SHA-256
 * where the store keeps one. That works for every class, Deep Archive included, because it only reads
 * what the store says. R2 originals with an upload SHA-256 are also read back and hashed (R2 charges no
 * egress), which proves them byte for byte and sets `sha256_verified`.
 *
 * A problem is logged once, when it appears; the location keeps the latest result for the Storage page.
 */
import type { DamBindings } from '../env'
import { logActivity } from '../lib/activity'
import { toHex } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { getConnection, providerFor, type Connection } from '../storage/connections'
import type { ObjectHead } from '../storage/types'

export const CHECK_CYCLE_DAYS = 30
/** A store that couldn't be asked is asked again the next day, not next cycle. */
const RETRY_UNREADABLE_MS = 86_400_000
export const CHECKS_PER_RUN = 25
/** Read-backs per run, and the largest original read back (the browser hashes up to 512 MB). */
const VERIFY_PER_RUN = 2
const VERIFY_MAX_BYTES = 512 * 1024 * 1024

export type CheckResult = 'ok' | 'missing' | 'changed' | 'unreadable'
export const PROBLEMS: readonly CheckResult[] = ['missing', 'changed', 'unreadable']

interface DueRow {
  asset_id: string
  connection_id: string
  key: string
  state: string
  size: number | null
  etag: string | null
  storage_class: string
  check_result: string | null
  sha256: string | null
  sha256_verified: number
}

interface Outcome {
  result: CheckResult
  detail: string | null
  /** What to record from the store: a changed class, or size and etag first seen. */
  adopt?: { storageClass?: string; size?: number; etag?: string }
  verified?: boolean
}

const unquote = (etag: string | null | undefined) => (etag ?? '').replace(/^W\//, '').replace(/"/g, '').toLowerCase()
const CHECKABLE_STATES = new Set(['present', 'restoring', 'restored'])

/** Compare what the store says with what the catalog recorded. */
export function compare(row: Pick<DueRow, 'size' | 'etag' | 'storage_class' | 'sha256'>, head: ObjectHead | null): Outcome {
  if (!head) return { result: 'missing', detail: 'The store no longer has this file.' }
  if (row.size !== null && head.size !== row.size) {
    return { result: 'changed', detail: `The store has ${head.size.toLocaleString('en')} bytes; ${row.size.toLocaleString('en')} were recorded.` }
  }
  if (row.etag && head.etag && unquote(head.etag) !== unquote(row.etag)) {
    return { result: 'changed', detail: 'The store holds a different file under this name (its etag changed).' }
  }
  if (row.sha256 && head.sha256 && head.sha256.toLowerCase() !== row.sha256.toLowerCase()) {
    return { result: 'changed', detail: "The store's SHA-256 doesn't match the one taken at upload." }
  }
  const adopt: Outcome['adopt'] = {}
  // A lifecycle rule moving the file isn't a problem: the catalog follows.
  if (head.storageClass !== row.storage_class) adopt.storageClass = head.storageClass
  // Recorded by a path that didn't know them (an import): from now on, they're what's expected.
  if (row.size === null) adopt.size = head.size
  if (!row.etag && head.etag) adopt.etag = head.etag
  return { result: 'ok', detail: null, adopt }
}

/** Read an R2 original back and hash it. */
async function readBack(env: DamBindings, connection: Connection, key: string): Promise<string | null> {
  const object = await providerFor(env, connection).get(key)
  if (!object) return null
  // Workers hash as the bytes stream past; the tests run in Node, which has no DigestStream.
  const Streaming = (crypto as unknown as { DigestStream?: typeof DigestStream }).DigestStream
  if (!Streaming) return toHex(await crypto.subtle.digest('SHA-256', await new Response(object.body).arrayBuffer()))
  const digest = new Streaming('SHA-256')
  await object.body.pipeTo(digest)
  return toHex(await digest.digest)
}

/** One run's worth of checks. `more()` says whether the run's slice allows another. */
export async function checkStorage(env: DamBindings, more: () => boolean): Promise<{ checked: number; problems: number }> {
  const db = env.DB
  const now = nowIso()
  const { results: due } = await db
    .prepare(
      `SELECT l.asset_id, l.connection_id, l.key, l.state, l.size, l.etag, l.storage_class, l.check_result,
              a.sha256, a.sha256_verified
       FROM asset_locations l JOIN assets a ON a.id = l.asset_id
       WHERE l.storage_class != 'NAS' AND (l.check_due_at IS NULL OR l.check_due_at <= ?)
       ORDER BY l.check_due_at LIMIT ?`,
    )
    .bind(now, CHECKS_PER_RUN)
    .all<DueRow>()

  const connections = new Map<string, Connection | null>()
  const statements: D1PreparedStatement[] = []
  const verified: string[] = []
  let checked = 0
  let problems = 0
  let readBacks = 0
  const cycle = new Date(Date.now() + CHECK_CYCLE_DAYS * 86_400_000).toISOString()

  for (const row of due) {
    if (!more()) break
    if (!connections.has(row.connection_id)) connections.set(row.connection_id, await getConnection(db, row.connection_id))
    const connection = connections.get(row.connection_id)
    // An upload still arriving, or a connection that's gone: nothing to ask yet; look again next cycle.
    if (!connection || connection.provider === 'nas' || !CHECKABLE_STATES.has(row.state)) {
      statements.push(db.prepare('UPDATE asset_locations SET check_due_at = ? WHERE asset_id = ? AND connection_id = ?').bind(cycle, row.asset_id, row.connection_id))
      continue
    }

    let outcome: Outcome
    try {
      outcome = compare(row, await providerFor(env, connection).head(row.key))
      const canReadBack =
        outcome.result === 'ok' && connection.provider === 'r2-binding' && row.sha256 && !row.sha256_verified && (row.size ?? Infinity) <= VERIFY_MAX_BYTES
      if (canReadBack && readBacks < VERIFY_PER_RUN) {
        readBacks++
        const hash = await readBack(env, connection, row.key)
        if (hash === null) outcome = { result: 'missing', detail: 'The store no longer has this file.' }
        else if (hash !== row.sha256!.toLowerCase()) outcome = { result: 'changed', detail: "The file's contents don't match what was uploaded (SHA-256)." }
        else outcome.verified = true
      }
    } catch (error) {
      outcome = { result: 'unreadable', detail: error instanceof Error ? error.message.slice(0, 300) : String(error) }
    }
    checked++

    const nextDue = outcome.result === 'unreadable' ? new Date(Date.now() + RETRY_UNREADABLE_MS).toISOString() : cycle
    const { adopt = {} } = outcome
    statements.push(
      db
        .prepare(
          `UPDATE asset_locations SET checked_at = ?, check_due_at = ?, check_result = ?, check_detail = ?,
             storage_class = COALESCE(?, storage_class), size = COALESCE(?, size), etag = COALESCE(?, etag)
           WHERE asset_id = ? AND connection_id = ?`,
        )
        .bind(now, nextDue, outcome.result, outcome.detail, adopt.storageClass ?? null, adopt.size ?? null, adopt.etag ?? null, row.asset_id, row.connection_id),
    )
    if (outcome.verified) verified.push(row.asset_id)
    if (outcome.result !== 'ok') {
      problems++
      // Logged when it appears or turns into another problem, not every cycle it persists.
      if (outcome.result !== row.check_result) {
        await logActivity(db, {
          userId: null,
          action: 'storage.check_problem',
          targetType: 'asset',
          targetId: row.asset_id,
          details: { result: outcome.result, detail: outcome.detail, connection: connection.name, key: row.key },
        })
      }
    }
  }
  if (verified.length > 0) {
    statements.push(db.prepare('UPDATE assets SET sha256_verified = 1 WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(verified)))
  }
  if (statements.length > 0) await db.batch(statements)
  return { checked, problems }
}
