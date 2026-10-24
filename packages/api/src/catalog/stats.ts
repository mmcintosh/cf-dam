/**
 * Whole-archive numbers, built by the sweep a slice at a time (research/SCALE-1.4M-v1.md in
 * cf-dam-docs): the unfiltered facets, timeline, keyword counts, exact-duplicate groups, storage-check
 * totals and the photo count. At 1.4 million photos each of these read everything and took 1 to 78
 * seconds; D1 stops a query at 30. Built from rowid ranges (and SHA-256 prefixes) whose counts add up,
 * so no single query reads more than a slice, and kept as one snapshot that pages read instantly.
 *
 * A snapshot is at most a few minutes old. Filtered views count live (see `facets`).
 */
import type { DamBindings } from '../env'
import { nowIso } from '../lib/time'
import { buildWhere, CONTENT_KEY, KIND_SQL, ORIENTATION_SQL, TIER_SQL } from './assets'
import { SUBTREE } from './keywords'

/** Assets (or locations) per slice: each slice's queries read this many rows. */
export const SLICE_ROWS = 50_000
/** A finished snapshot is rebuilt once it's this old. */
const REBUILD_AFTER_MS = 10 * 60_000
const SNAPSHOT_KEY = 'stats'
const BUILD_KEY = 'stats.build'

/** The plain facets: one value column each, grouped over the archive. */
export const PLAIN_FACETS = {
  year: { expr: "COALESCE(substr(a.captured_at, 1, 4), 'undated')", limit: 100 },
  camera: { expr: 'a.camera_model', limit: 30 },
  lens: { expr: 'a.lens', limit: 30 },
  rating: { expr: 'CAST(a.rating AS TEXT)', limit: 6 },
  flag: { expr: "COALESCE(a.flag, 'none')", limit: 3 },
  label: { expr: 'a.label', limit: 5 },
  country: { expr: 'a.country', limit: 40 },
  city: { expr: 'a.city', limit: 40 },
  creator: { expr: 'a.creator', limit: 20 },
  orientation: { expr: `(${ORIENTATION_SQL})`, limit: 3 },
  type: { expr: `(${KIND_SQL})`, limit: 4 },
  tier: { expr: TIER_SQL, limit: 4 },
  people: { expr: 'a.facet_people', limit: 5 },
} as const
export type PlainFacet = keyof typeof PLAIN_FACETS

type Counts = Record<string, number>

export interface StatsSnapshot {
  builtAt: string
  photos: number
  /** Value counts per plain facet, every value (the facet's limit is applied when shown). */
  facets: Record<PlainFacet, Counts>
  /** Photos per keyword: with the keyword itself (`own`) and with it or anything below (`total`). */
  keywords: Record<string, { own: number; total: number }>
  /** Photos per month (yyyy-mm). */
  months: Counts
  /** Groups of photos sharing a SHA-256. */
  exactDuplicateGroups: number
  /** Originals outside a NAS by their latest check: ok, missing, changed, unreadable, unchecked. */
  checks: Counts
  /** The most recent check of any of them. */
  lastCheckedAt: string | null
}

interface Build {
  startedAt: string
  phase: 'assets' | 'sha' | 'locations'
  /** The last rowid (or SHA-256 prefix index) done in this phase. */
  after: number
  partial: Omit<StatsSnapshot, 'builtAt'>
}

const emptyPartial = (): Build['partial'] => ({
  photos: 0,
  facets: Object.fromEntries(Object.keys(PLAIN_FACETS).map((k) => [k, {}])) as Record<PlainFacet, Counts>,
  keywords: {},
  months: {},
  exactDuplicateGroups: 0,
  checks: {},
  lastCheckedAt: null,
})

const add = (into: Counts, key: string, n: number) => {
  into[key] = (into[key] ?? 0) + n
}

async function save(db: D1Database, key: string, value: unknown): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, JSON.stringify(value), nowIso())
    .run()
}

export async function getStats(db: D1Database): Promise<StatsSnapshot | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(SNAPSHOT_KEY).first<{ value: string }>()
  return row ? (JSON.parse(row.value) as StatsSnapshot) : null
}

/** One slice of assets: every plain facet, the month, and the keyword roll-up. */
async function assetSlice(db: D1Database, after: number, partial: Build['partial'], rows: number): Promise<number | null> {
  const last = await db
    .prepare('SELECT MAX(rowid) AS last FROM (SELECT rowid FROM assets WHERE rowid > ? ORDER BY rowid LIMIT ?)')
    .bind(after, rows)
    .first<{ last: number | null }>()
  if (!last?.last) return null
  const base = `${buildWhere({}).clause} AND a.rowid > ? AND a.rowid <= ?`
  const range = [after, last.last]
  // One statement per facet: D1 allows only a few terms in a compound (UNION ALL) SELECT.
  const names = Object.keys(PLAIN_FACETS) as PlainFacet[]
  const results = await db.batch([
    ...names.map((name) => db.prepare(`SELECT ${PLAIN_FACETS[name].expr} AS value, COUNT(*) AS n FROM assets a WHERE ${base} GROUP BY value`).bind(...range)),
    db.prepare(`SELECT substr(a.captured_at, 1, 7) AS month, COUNT(*) AS n FROM assets a WHERE ${base} GROUP BY month`).bind(...range),
    // A photo's tags are all in its own slice, so per-slice distinct counts add up across slices.
    db
      .prepare(
        `${SUBTREE('SELECT id FROM tags')}
         SELECT under.root AS id, COUNT(DISTINCT CASE WHEN under.id = under.root THEN a.id END) AS own, COUNT(DISTINCT a.id) AS total
         FROM assets a JOIN asset_tags at ON at.asset_id = a.id JOIN under ON under.id = at.tag_id
         WHERE ${base} GROUP BY under.root`,
      )
      .bind(...range),
  ])
  names.forEach((name, i) => {
    for (const row of results[i]!.results as { value: string | null; n: number }[]) {
      if (name === 'year') partial.photos += row.n
      // A build begun before a facet existed has no counts for it yet.
      if (row.value !== null) add((partial.facets[name] ??= {}), String(row.value), row.n)
    }
  })
  const months = results[names.length]
  const keywords = results[names.length + 1]
  for (const row of months!.results as { month: string | null; n: number }[]) if (row.month) add(partial.months, row.month, row.n)
  for (const row of keywords!.results as { id: string; own: number; total: number }[]) {
    const k = (partial.keywords[row.id] ??= { own: 0, total: 0 })
    k.own += row.own
    k.total += row.total
  }
  return last.last
}

const HEX = '0123456789abcdef'

/** Exact-duplicate groups whose content key starts with one hex digit (groups never cross prefixes). */
async function shaSlice(db: D1Database, index: number, partial: Build['partial']): Promise<number | null> {
  if (index >= HEX.length) return null
  const from = HEX[index]!
  const to = index + 1 < HEX.length ? HEX[index + 1]! : 'g'
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM (SELECT 1 FROM assets WHERE deleted_at IS NULL AND ${CONTENT_KEY} >= ? AND ${CONTENT_KEY} < ? GROUP BY ${CONTENT_KEY} HAVING COUNT(*) > 1)`,
    )
    .bind(from, to)
    .first<{ n: number }>()
  partial.exactDuplicateGroups += row?.n ?? 0
  return index + 1
}

async function locationSlice(db: D1Database, after: number, partial: Build['partial'], rows: number): Promise<number | null> {
  const last = await db
    .prepare('SELECT MAX(rowid) AS last FROM (SELECT rowid FROM asset_locations WHERE rowid > ? ORDER BY rowid LIMIT ?)')
    .bind(after, rows)
    .first<{ last: number | null }>()
  if (!last?.last) return null
  const { results } = await db
    .prepare(
      `SELECT COALESCE(check_result, 'unchecked') AS result, COUNT(*) AS n, MAX(checked_at) AS last FROM asset_locations
       WHERE rowid > ? AND rowid <= ? AND storage_class != 'NAS' GROUP BY check_result`,
    )
    .bind(after, last.last)
    .all<{ result: string; n: number; last: string | null }>()
  for (const row of results) {
    add(partial.checks, row.result, row.n)
    if (row.last && (!partial.lastCheckedAt || row.last > partial.lastCheckedAt)) partial.lastCheckedAt = row.last
  }
  return last.last
}

/**
 * The sweep's stats stage: carry on a build while `more()` allows, start one when the snapshot is due,
 * and publish it when every phase is done. Returns whether a snapshot was published.
 */
export async function statsStep(env: DamBindings, more: () => boolean, sliceRows = SLICE_ROWS): Promise<boolean> {
  const db = env.DB
  const row = await db
    .prepare('SELECT (SELECT value FROM settings WHERE key = ?) AS build, (SELECT updated_at FROM settings WHERE key = ?) AS built')
    .bind(BUILD_KEY, SNAPSHOT_KEY)
    .first<{ build: string | null; built: string | null }>()
  let build = row?.build ? (JSON.parse(row.build) as Build) : null
  if (!build) {
    if (row?.built && Date.now() - Date.parse(row.built) < REBUILD_AFTER_MS) return false
    build = { startedAt: nowIso(), phase: 'assets', after: 0, partial: emptyPartial() }
  }

  while (more()) {
    const next =
      build.phase === 'assets'
        ? await assetSlice(db, build.after, build.partial, sliceRows)
        : build.phase === 'sha'
          ? await shaSlice(db, build.after, build.partial)
          : await locationSlice(db, build.after, build.partial, sliceRows)
    if (next !== null) {
      build.after = next
      continue
    }
    if (build.phase === 'assets') build = { ...build, phase: 'sha', after: 0 }
    else if (build.phase === 'sha') build = { ...build, phase: 'locations', after: 0 }
    else {
      // Long tails (every city, every lens) are cut well past what a facet shows, to keep the row small.
      const facets = Object.fromEntries(
        (Object.keys(PLAIN_FACETS) as PlainFacet[]).map((name) => [name, Object.fromEntries(topValues(build!.partial.facets[name] ?? {}, 500).map((v) => [v.value, v.count]))]),
      ) as Record<PlainFacet, Counts>
      const snapshot: StatsSnapshot = { builtAt: build.startedAt, ...build.partial, facets }
      await db.batch([
        db
          .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
          .bind(SNAPSHOT_KEY, JSON.stringify(snapshot), nowIso()),
        db.prepare('DELETE FROM settings WHERE key = ?').bind(BUILD_KEY),
      ])
      return true
    }
  }
  await save(db, BUILD_KEY, build)
  return false
}

/** The top values of a facet from a snapshot, as the live query would order them. */
export function topValues(counts: Counts, limit: number): { value: string; count: number }[] {
  return Object.entries(counts)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit)
}
