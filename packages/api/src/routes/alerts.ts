/**
 * Alerts, for administrators (`alerts:read`): what's wrong now, newest first, and what was put right
 * lately. The sweep opens and resolves them (catalog/alerts.ts); people can only dismiss one, which
 * takes it out of the count until it resolves.
 */
import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import { sweepStalledSince } from '../catalog/alerts'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { nowIso } from '../lib/time'

/** Resolved alerts are listed for this long. */
const RESOLVED_DAYS = 14
const RESOLVED_LIST = 50

interface AlertRow {
  id: string
  kind: string
  message: string
  link: string | null
  opened_at: string
  seen_at: string
  dismissed_at: string | null
  dismissed_by_name: string | null
  resolved_at: string | null
}

const toAlert = (r: AlertRow) => ({
  id: r.id,
  kind: r.kind,
  message: r.message,
  link: r.link,
  openedAt: r.opened_at,
  seenAt: r.seen_at,
  dismissedAt: r.dismissed_at,
  dismissedBy: r.dismissed_by_name,
  resolvedAt: r.resolved_at,
})

export const alertRoutes = new Hono<DamEnv>()

alertRoutes.use('*', requirePermission('alerts:read'))

alertRoutes.get('/', async (c) => {
  const db = c.env.DB
  const select = `SELECT a.id, a.kind, a.message, a.link, a.opened_at, a.seen_at, a.dismissed_at, COALESCE(u.name, u.email) AS dismissed_by_name, a.resolved_at
                  FROM alerts a LEFT JOIN users u ON u.id = a.dismissed_by`
  const [open, resolved] = await db.batch([
    db.prepare(`${select} WHERE a.resolved_at IS NULL ORDER BY a.dismissed_at IS NOT NULL, a.opened_at DESC`),
    db.prepare(`${select} WHERE a.resolved_at > ? ORDER BY a.resolved_at DESC LIMIT ?`).bind(new Date(Date.now() - RESOLVED_DAYS * 86_400_000).toISOString(), RESOLVED_LIST),
  ])
  return c.json({
    open: (open!.results as unknown as AlertRow[]).map(toAlert),
    resolved: (resolved!.results as unknown as AlertRow[]).map(toAlert),
    sweepStalledSince: await sweepStalledSince(db),
  })
})

alertRoutes.post('/:id/dismiss', async (c) => {
  const principal = c.get('principal')!
  const row = await c.env.DB.prepare('UPDATE alerts SET dismissed_at = ?, dismissed_by = ? WHERE id = ? AND resolved_at IS NULL AND dismissed_at IS NULL RETURNING kind, message')
    .bind(nowIso(), principal.userId, c.req.param('id'))
    .first<{ kind: string; message: string }>()
  if (!row) return c.json({ error: 'not_found' }, 404)
  await logActivity(c.env.DB, { userId: principal.userId, action: 'alert.dismissed', targetType: 'alert', targetId: c.req.param('id'), details: { kind: row.kind, message: row.message } })
  return c.body(null, 204)
})

/** Back into the count. */
alertRoutes.post('/:id/restore', async (c) => {
  const result = await c.env.DB.prepare('UPDATE alerts SET dismissed_at = NULL, dismissed_by = NULL WHERE id = ? AND resolved_at IS NULL AND dismissed_at IS NOT NULL')
    .bind(c.req.param('id'))
    .run()
  if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404)
  return c.body(null, 204)
})
