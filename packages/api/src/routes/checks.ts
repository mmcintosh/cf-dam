/** Storage checks for the Storage page (catalog/checks.ts does the checking). Needs `sources:manage`. */
import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import { CHECK_CYCLE_DAYS, PROBLEMS } from '../catalog/checks'
import type { DamEnv } from '../env'
import { BadRequest, readJsonObject, requiredString } from '../lib/http'

const PROBLEM_LIST = 200

export const checkRoutes = new Hono<DamEnv>()

checkRoutes.use('*', requirePermission('sources:manage'))

checkRoutes.get('/', async (c) => {
  const db = c.env.DB
  const [totals, problems] = await db.batch([
    db.prepare(
      `SELECT COALESCE(check_result, 'unchecked') AS result, COUNT(*) AS n, MAX(checked_at) AS last
       FROM asset_locations WHERE storage_class != 'NAS' GROUP BY check_result`,
    ),
    db
      .prepare(
        `SELECT l.asset_id, a.filename, l.connection_id, c.name AS connection_name, l.key, l.check_result, l.check_detail, l.checked_at
         FROM asset_locations l JOIN assets a ON a.id = l.asset_id LEFT JOIN storage_connections c ON c.id = l.connection_id
         WHERE l.check_result IN (SELECT value FROM json_each(?))
         ORDER BY l.checked_at DESC LIMIT ?`,
      )
      .bind(JSON.stringify(PROBLEMS), PROBLEM_LIST),
  ])
  const counts: Record<string, number> = { ok: 0, missing: 0, changed: 0, unreadable: 0, unchecked: 0 }
  let lastCheckedAt: string | null = null
  for (const row of totals!.results as { result: string; n: number; last: string | null }[]) {
    counts[row.result] = row.n
    if (row.last && (!lastCheckedAt || row.last > lastCheckedAt)) lastCheckedAt = row.last
  }
  return c.json({
    cycleDays: CHECK_CYCLE_DAYS,
    totals: counts,
    lastCheckedAt,
    problems: (problems!.results as Record<string, string | null>[]).map((r) => ({
      assetId: r.asset_id,
      filename: r.filename,
      connectionId: r.connection_id,
      connectionName: r.connection_name,
      key: r.key,
      result: r.check_result,
      detail: r.check_detail,
      checkedAt: r.checked_at,
    })),
  })
})

/** Check one location again on the next run (after putting a file back, say). */
checkRoutes.post('/recheck', async (c) => {
  try {
    const body = await readJsonObject(c)
    const result = await c.env.DB.prepare('UPDATE asset_locations SET check_due_at = NULL WHERE asset_id = ? AND connection_id = ?')
      .bind(requiredString(body, 'assetId'), requiredString(body, 'connectionId'))
      .run()
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404)
    return c.body(null, 204)
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})
