/**
 * What a storage connection holds and what uses it (plans/PLAN-ST-v2.md in cf-dam-docs): the rows of the Storage
 * page, a connection's own page, and what stops it being removed or its bucket being changed.
 *
 * Counted from the catalogue, never by listing the bucket. Only the Storage page and a connection's page ask
 * (people with sources:manage), never the uploader's connection list or the pages' CSP.
 */
import { TIER_CLASSES, type Tier } from '../catalog/assets'

export interface ConnectionUses {
  /** Originals with a copy here, in any state (a gone or trashed copy still names its key here). */
  originals: number
  /** Job archive copies still to make here; and ones that failed for good (they don't block anything). */
  archiveWaiting: number
  archiveFailed: number
  /** A NAS or Mac helper's archive uploads under way here. */
  agentUploads: number
  /** Restores asked of this bucket that haven't been asked yet. */
  restores: number
  /** Catalog backups kept here: removing the connection would lose them. */
  backups: number
  /** Archive delivered jobs sends copies here (and is on). */
  jobArchive: boolean
  /** The daily catalog backup goes here. */
  backupDestination: boolean
  /** NAS or Mac helpers archiving their originals here, by name. */
  agents: string[]
  /** New uploads go here unless another is picked. */
  isDefault: boolean
}

/** Whether anything stops the connection being removed or its bucket, region, endpoint or folder being changed. */
export function inUse(uses: ConnectionUses): boolean {
  return (
    uses.originals > 0 ||
    uses.archiveWaiting > 0 ||
    uses.agentUploads > 0 ||
    uses.restores > 0 ||
    uses.backups > 0 ||
    uses.jobArchive ||
    uses.backupDestination ||
    uses.agents.length > 0
  )
}

const parse = (value: string | null): Record<string, unknown> => {
  try {
    return value ? (JSON.parse(value) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Everything that uses one connection: one round trip. */
export async function connectionUses(db: D1Database, id: string): Promise<ConnectionUses> {
  const [counts, agents] = await db.batch([
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM asset_locations WHERE connection_id = ?1) AS originals,
                (SELECT COUNT(*) FROM archive_items WHERE connection_id = ?1 AND state NOT IN ('done', 'failed')) AS archiveWaiting,
                (SELECT COUNT(*) FROM archive_items WHERE connection_id = ?1 AND state = 'failed') AS archiveFailed,
                (SELECT COUNT(*) FROM archive_uploads WHERE connection_id = ?1) AS agentUploads,
                (SELECT COUNT(*) FROM restore_items WHERE connection_id = ?1 AND state IN ('waiting', 'asking')) AS restores,
                (SELECT COUNT(*) FROM backups WHERE connection_id = ?1) AS backups,
                (SELECT value FROM settings WHERE key = 'archive.jobs') AS jobs,
                (SELECT value FROM settings WHERE key = 'backup') AS backup,
                (SELECT is_default FROM storage_connections WHERE id = ?1) AS isDefault`,
      )
      .bind(id),
    db.prepare("SELECT name FROM sources WHERE json_extract(archive, '$.connectionId') = ? ORDER BY name").bind(id),
  ])
  const row = (counts!.results[0] ?? {}) as Record<string, number | string | null>
  const jobs = parse(row.jobs as string | null)
  return {
    originals: Number(row.originals ?? 0),
    archiveWaiting: Number(row.archiveWaiting ?? 0),
    archiveFailed: Number(row.archiveFailed ?? 0),
    agentUploads: Number(row.agentUploads ?? 0),
    restores: Number(row.restores ?? 0),
    backups: Number(row.backups ?? 0),
    jobArchive: jobs.enabled === true && jobs.connectionId === id,
    backupDestination: parse(row.backup as string | null).connectionId === id,
    agents: (agents!.results as { name: string }[]).map((r) => r.name),
    isDefault: row.isDefault === 1,
  }
}

let tiers: Map<string, Tier> | null = null
/** A storage class's tier, as the Library's Storage filter groups them. */
export function tierOf(storageClass: string): Tier {
  tiers ??= new Map(Object.entries(TIER_CLASSES).flatMap(([tier, classes]) => classes.map((c) => [c, tier as Tier] as const)))
  return tiers.get(storageClass) ?? 'warm'
}

export interface ConnectionUsage {
  /** Originals kept here (not gone, not still uploading) and their bytes. */
  originals: number
  bytes: number
  /** The same by tier, for the Library links (on=…&tier=…). */
  tiers: Partial<Record<Tier, { count: number; bytes: number }>>
  /** Copies restored from a cold class and readable now. */
  restored: number
}

const emptyUsage = (): ConnectionUsage => ({ originals: 0, bytes: 0, tiers: {}, restored: 0 })

/** What each connection keeps, from the catalogue: one grouped query for all of them. */
export async function connectionUsage(db: D1Database, ids: string[]): Promise<Map<string, ConnectionUsage>> {
  const out = new Map(ids.map((id) => [id, emptyUsage()]))
  if (ids.length === 0) return out
  const { results } = await db
    .prepare(
      `SELECT connection_id, storage_class, COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes,
              COUNT(CASE WHEN restore_expires_at > ? THEN 1 END) AS restored
       FROM asset_locations WHERE connection_id IN (SELECT value FROM json_each(?)) AND state NOT IN ('pending', 'gone')
       GROUP BY connection_id, storage_class`,
    )
    .bind(new Date().toISOString(), JSON.stringify(ids))
    .all<{ connection_id: string; storage_class: string; count: number; bytes: number; restored: number }>()
  for (const r of results) {
    const usage = out.get(r.connection_id)!
    usage.originals += r.count
    usage.bytes += r.bytes
    usage.restored += r.restored
    const tier = (usage.tiers[tierOf(r.storage_class)] ??= { count: 0, bytes: 0 })
    tier.count += r.count
    tier.bytes += r.bytes
  }
  return out
}
