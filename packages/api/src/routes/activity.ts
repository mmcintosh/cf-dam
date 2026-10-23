/**
 * The activity log, for administrators (`activity:read`): newest first, a page at a time, by person
 * and by kind. Entries are returned as stored, with the names of the people involved; the page turns
 * them into sentences.
 */
import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import type { DamEnv } from '../env'

export const PAGE_SIZE = 50

/** Kinds of entry, as action prefixes. A prefix `p` matches `p.` up to (not including) `p/`. */
export const ACTIVITY_KINDS: Readonly<Record<string, readonly string[]>> = {
  'sign-ins': ['auth'],
  accounts: ['account', 'user', 'policy', 'api_key', 'setup'],
  photos: ['asset', 'album', 'duplicates', 'keyword', 'storage', 'ai', 'previews'],
  sharing: ['share', 'watermark'],
  agents: ['source'],
  backups: ['backup'],
  alerts: ['alert'],
}

interface EntryRow {
  id: string
  created_at: string
  action: string
  user_id: string | null
  actor_name: string | null
  actor_email: string | null
  target_type: string | null
  target_id: string | null
  target_name: string | null
  target_email: string | null
  details: string | null
  ip_address: string | null
}

export const activityRoutes = new Hono<DamEnv>()

activityRoutes.use('*', requirePermission('activity:read'))

activityRoutes.get('/', async (c) => {
  const person = c.req.query('person')
  const kind = c.req.query('kind')
  const before = c.req.query('before')
  const where: string[] = []
  const binds: unknown[] = []

  if (kind) {
    const prefixes = ACTIVITY_KINDS[kind]
    if (!prefixes) return c.json({ error: 'invalid_request', message: `kind must be one of: ${Object.keys(ACTIVITY_KINDS).join(', ')}.` }, 400)
    // A range per prefix rather than LIKE, so the action index is used.
    where.push(`(${prefixes.map(() => '(a.action >= ? AND a.action < ?)').join(' OR ')})`)
    for (const p of prefixes) binds.push(`${p}.`, `${p}/`)
  }
  if (person) {
    // Things they did, and things done to their account (a failed sign-in has no one doing it).
    where.push("(a.user_id = ? OR (a.target_type = 'user' AND a.target_id = ?))")
    binds.push(person, person)
  }
  if (before) {
    const [at, id] = before.split('|')
    if (!at || !id) return c.json({ error: 'invalid_request', message: 'before is the `next` value of a previous page.' }, 400)
    where.push('(a.created_at < ? OR (a.created_at = ? AND a.id < ?))')
    binds.push(at, at, id)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.created_at, a.action, a.user_id, a.target_type, a.target_id, a.details, a.ip_address,
            actor.name AS actor_name, actor.email AS actor_email,
            target.name AS target_name, target.email AS target_email
     FROM activity_log a
     LEFT JOIN users actor ON actor.id = a.user_id
     LEFT JOIN users target ON a.target_type = 'user' AND target.id = a.target_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ?`,
  )
    .bind(...binds, PAGE_SIZE + 1)
    .all<EntryRow>()

  const page = results.slice(0, PAGE_SIZE)
  const last = page.at(-1)
  return c.json({
    entries: page.map((r) => ({
      id: r.id,
      at: r.created_at,
      action: r.action,
      actor: r.user_id ? { id: r.user_id, name: r.actor_name, email: r.actor_email } : null,
      target: r.target_type ? { type: r.target_type, id: r.target_id, name: r.target_name, email: r.target_email } : null,
      details: r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null,
      ipAddress: r.ip_address,
    })),
    next: results.length > PAGE_SIZE && last ? `${last.created_at}|${last.id}` : null,
  })
})
