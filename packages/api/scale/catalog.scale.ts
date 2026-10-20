/**
 * The scale test: build (or reuse) a catalog of SCALE_PHOTOS photos on disk, then time what people and
 * the sweep do to it, with each statement's query plan. Run it with
 *
 *   SCALE_PHOTOS=1400000 npx vitest run --config scale/vitest.config.ts
 *
 * Results go to scale/results/<photos>.json and are printed as a table. See scale/README.md.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { getAsset, getLocations, getTags, listAssets, type ListFilters } from '../src/catalog/assets'
import { backupStep, DEFAULT_BACKUP_CONFIG, setBackupConfig } from '../src/catalog/backups'
import { duplicateCounts, exactGroups, similarGroups } from '../src/catalog/duplicates'
import { keywordTree } from '../src/catalog/keywords'
import { facets, geoPoints, timeline } from '../src/catalog/library'
import { unindexed } from '../src/catalog/search'
import { statsStep } from '../src/catalog/stats'
import { migrate } from '../src/db/migrate'
import type { DamBindings } from '../src/env'
import { asD1, D1Sqlite, type Recorded } from './d1-sqlite'
import { generate } from './generate'

const PHOTOS = Number(process.env.SCALE_PHOTOS ?? 100_000)
const DIR = process.env.SCALE_DIR ?? join(homedir(), 'cf-dam-scale')
const PATH = join(DIR, `catalog-${PHOTOS}.db`)

interface Measured {
  name: string
  ms: number
  statements: number
  /** Statements whose plan reads a whole table or index (SCAN …), with the slowest first. */
  scans: { sql: string; ms: number; plan: string[] }[]
  slowest: { sql: string; ms: number }
}

const short = (sql: string) => sql.replace(/\s+/g, ' ').trim().slice(0, 160)

it(`scale: ${PHOTOS.toLocaleString()} photos`, async () => {
  mkdirSync(DIR, { recursive: true })
  const fresh = !existsSync(PATH)
  const db = new D1Sqlite(PATH)
  const d1 = asD1(db)
  const report: Record<string, unknown> = { photos: PHOTOS, at: new Date().toISOString() }

  if (fresh) {
    console.log(`building ${PATH}`)
    report.generate = await generate(db, { photos: PHOTOS, progress: (m) => console.log(new Date().toISOString().slice(11, 19), m) })
  } else {
    // A catalog from an earlier run gets the migrations added since (new indexes, say).
    const started = performance.now()
    report.migrated = { names: await migrate(d1), ms: Math.round(performance.now() - started) }
  }
  // No planner statistics: D1 doesn't gather them by itself, so plans are measured without.
  db.sqlite.exec('DROP TABLE IF EXISTS sqlite_stat1; DROP TABLE IF EXISTS sqlite_stat4')
  db.take()

  const measure = async (name: string, run: () => Promise<unknown>): Promise<Measured> => {
    const started = performance.now()
    await run()
    const ms = performance.now() - started
    const log: Recorded[] = db.take()
    const scans = log
      .map((r) => ({ sql: r.sql, ms: r.ms, plan: db.plan(r.sql, r.params) }))
      .filter((r) => r.plan.some((line) => /^SCAN /.test(line) && !/^SCAN (j|json_each|CONSTANT ROW)/.test(line)))
      .sort((a, b) => b.ms - a.ms)
      .map((r) => ({ ...r, sql: short(r.sql), ms: Math.round(r.ms) }))
    const slow = [...log].sort((a, b) => b.ms - a.ms)[0]
    return { name, ms: Math.round(ms), statements: log.length, scans, slowest: { sql: short(slow?.sql ?? ''), ms: Math.round(slow?.ms ?? 0) } }
  }

  const species = db.sqlite.prepare("SELECT id, full_path FROM tags WHERE path LIKE 'birds|herons|%' AND parent_id IS NOT NULL ORDER BY path DESC LIMIT 1").get() as { id: string; full_path: string }
  const country = db.sqlite.prepare("SELECT id FROM tags WHERE path = 'places|norway'").get() as { id: string }
  const someId = (db.sqlite.prepare('SELECT id FROM assets WHERE rowid = ?').get(Math.ceil(PHOTOS / 2)) as { id: string }).id
  const list = (filters: ListFilters) => () => listAssets(d1, filters)

  // The whole-archive snapshot, built as the sweep would: one slice per call, each timed.
  const statsEnv = { DB: d1 } as unknown as DamBindings
  await d1.prepare("DELETE FROM settings WHERE key IN ('stats', 'stats.build')").run()
  const sliceMs: number[] = []
  const statsStarted = performance.now()
  for (let done = false; !done; ) {
    const started = performance.now()
    let n = 0
    done = await statsStep(statsEnv, () => n++ < 1)
    sliceMs.push(performance.now() - started)
    db.take()
  }
  report.stats = {
    ms: Math.round(performance.now() - statsStarted),
    slices: sliceMs.length,
    slowestSliceMs: Math.round(Math.max(...sliceMs)),
    averageSliceMs: Math.round(sliceMs.reduce((a, b) => a + b, 0) / sliceMs.length),
  }
  console.log('stats snapshot', report.stats)

  const results: Measured[] = []
  const run = async (name: string, fn: () => Promise<unknown>) => {
    const m = await measure(name, fn)
    results.push(m)
    console.log(`${String(m.ms).padStart(7)} ms  ${String(m.statements).padStart(3)} stmts  ${m.scans.length ? `${m.scans.length} scan(s)` : '        '}  ${name}`)
  }

  await run('Library, first page', list({}))
  await run('Library, page 100', list({ offset: 99 * 60 }))
  await run('Library, newest added', list({ sort: 'added' }))
  await run('Library, one year', list({ year: '2015' }))
  await run('Library, one month', list({ month: '2015-06' }))
  await run('Library, one species keyword', list({ tag: species.full_path }))
  await run('Library, a country and below', list({ keyword: country.id }))
  await run('Library, one camera', list({ camera: 'NIKON Z 9' }))
  await run('Library, 4+ stars', list({ rating: 4 }))
  await run('Library, on the NAS', list({ storedOn: 'nas' }))
  await run('Search "heron"', list({ q: 'heron' }))
  await run('Search "flight norway"', list({ q: 'flight norway' }))
  await run('Search "heron" in 2015', list({ q: 'heron', year: '2015' }))
  await run('Filters (facets), everything', () => facets(d1, {}))
  await run('Filters (facets), one year', () => facets(d1, { year: '2015' }))
  await run('Filters (facets), one camera', () => facets(d1, { camera: 'NIKON Z 9' }))
  await run('Filters (facets), one species', () => facets(d1, { tag: species.full_path }))
  await run('Timeline, one camera', () => timeline(d1, { camera: 'NIKON Z 9' }))
  await run('Timeline, everything', () => timeline(d1, {}))
  await run('Map points', () => geoPoints(d1, {}))
  await run('Keyword tree', () => keywordTree(d1))
  await run('Duplicate counts', () => duplicateCounts(d1))
  await run('Exact duplicates, first page', () => exactGroups(d1))
  await run('Look-alikes, first page', () => similarGroups(d1))
  await run('One photo (page)', async () => {
    await getAsset(d1, someId)
    await getTags(d1, someId)
    await getLocations(d1, someId)
  })
  await run('Sweep: search index repair (none due)', () => unindexed(d1, 50))
  await run('Sweep: storage checks due', () =>
    d1
      .prepare(
        `SELECT l.asset_id, l.connection_id, l.key, l.state, l.size, l.etag, l.storage_class, l.check_result, a.sha256, a.sha256_verified
         FROM asset_locations l JOIN assets a ON a.id = l.asset_id
         WHERE l.storage_class != 'NAS' AND (l.check_due_at IS NULL OR l.check_due_at <= ?) ORDER BY l.check_due_at LIMIT 25`,
      )
      .bind(new Date(Date.now() + 86_400_000).toISOString())
      .all(),
  )
  await run('Storage page: check totals', () =>
    d1.prepare(`SELECT COALESCE(check_result, 'unchecked') AS result, COUNT(*) AS n FROM asset_locations WHERE storage_class != 'NAS' GROUP BY check_result`).all(),
  )

  // A whole catalog backup into a bucket that only counts bytes.
  let bytes = 0
  let puts = 0
  const bucket = {
    put: async (_key: string, body: ArrayBuffer | string) => {
      bytes += typeof body === 'string' ? body.length : body.byteLength
      puts++
      return { etag: 'x', size: 0, uploaded: new Date(), checksums: {} }
    },
    head: async () => null,
    get: async () => null,
    delete: async () => {},
    list: async () => ({ objects: [], truncated: false }),
  }
  const env = { DB: d1, MEDIA_BUCKET: bucket } as unknown as DamBindings
  await setBackupConfig(d1, { ...DEFAULT_BACKUP_CONFIG, connectionId: 'r2' })
  await d1.prepare('DELETE FROM backups').run()
  await d1.prepare("DELETE FROM settings WHERE key = 'backup.state'").run()
  db.take()
  const backupStarted = performance.now()
  let pages = 0
  for (;;) {
    const step = await backupStep(env, () => true)
    pages += db.take().filter((r) => r.sql.includes('WHERE rowid > ?')).length
    if (step.finished) break
  }
  const backup = await d1.prepare('SELECT rows, bytes, chunks FROM backups LIMIT 1').first<{ rows: number; bytes: number; chunks: number }>()
  // The sweep gives backups 40 queries a minute: one per page of 1,000 rows, plus a few.
  report.backup = { ms: Math.round(performance.now() - backupStarted), ...backup, pages, puts, gzipBytes: bytes, sweepMinutesAt40Pages: Math.ceil(pages / 36) }

  const tables = db.sqlite
    .prepare("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 25")
    .all() as { name: string; bytes: number }[]
  const counts = Object.fromEntries(
    ['assets', 'asset_locations', 'renditions', 'asset_tags', 'asset_hash_bands', 'album_items', 'tags', 'search_index_data', 'search_index_content'].map((t) => [
      t,
      (db.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n,
    ]),
  )
  // Pages in use, not the file: the write-ahead log and free pages would overstate it.
  db.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const used = (db.sqlite.prepare('SELECT SUM(pgsize - unused) AS bytes FROM dbstat').get() as { bytes: number }).bytes
  const fileBytes = Math.max(used, statSync(PATH).size - (db.sqlite.prepare('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count * 4096)
  report.size = { fileBytes, bytesPerPhoto: Math.round(fileBytes / PHOTOS), d1LimitPhotos: Math.floor(10e9 / (fileBytes / PHOTOS)), tables, counts }
  report.operations = results
  console.log(JSON.stringify({ backup: report.backup, size: { ...(report.size as object), tables: undefined } }, null, 2))

  const resultsDir = fileURLToPath(new URL('./results/', import.meta.url))
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(join(resultsDir, `${PHOTOS}${process.env.SCALE_LABEL ? `-${process.env.SCALE_LABEL}` : ''}.json`), JSON.stringify(report, null, 2))
  db.close()
})
