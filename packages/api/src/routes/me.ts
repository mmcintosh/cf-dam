import { Hono } from 'hono'
import { createApiKey, listApiKeys, revokeApiKey } from '../auth/api-keys'
import { principalJson, requireAuth, requirePermission } from '../auth/principal'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject, requiredString, stringArray } from '../lib/http'
import { nowIso } from '../lib/time'

export const meRoutes = new Hono<DamEnv>()

meRoutes.use('*', requireAuth())

meRoutes.get('/', async (c) => {
  const principal = c.get('principal')!
  const row = await c.env.DB.prepare('SELECT two_factor_enabled, created_at, last_login_at FROM users WHERE id = ?')
    .bind(principal.userId)
    .first<{ two_factor_enabled: number; created_at: string; last_login_at: string | null }>()
  return c.json({
    ...principalJson(principal),
    twoFactorEnabled: row?.two_factor_enabled === 1,
    createdAt: row?.created_at ?? null,
    lastLoginAt: row?.last_login_at ?? null,
  })
})

meRoutes.get('/api-keys', requirePermission('apikeys:manage'), async (c) => {
  return c.json({ keys: await listApiKeys(c.env.DB, c.get('principal')!.userId) })
})

const MAX_EXPIRY_DAYS = 3650

meRoutes.post('/api-keys', requirePermission('apikeys:manage'), async (c) => {
  const principal = c.get('principal')!
  // A key can't mint keys: otherwise a leaked key could replace itself before it is revoked.
  if (principal.via !== 'session') return c.json({ error: 'session_required' }, 403)
  try {
    const body = await readJsonObject(c)
    const name = requiredString(body, 'name', 100)
    const scopes = stringArray(body, 'scopes') ?? []
    if (scopes.length === 0) throw new BadRequest('Choose at least one scope.')
    const notHeld = scopes.filter((s) => !principal.permissions.has(s))
    if (notHeld.length > 0) throw new BadRequest(`You can't grant scopes you don't hold: ${notHeld.join(', ')}`)

    let expiresAt: string | null = null
    if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
      const days = body.expiresInDays
      if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
        throw new BadRequest(`expiresInDays must be a whole number from 1 to ${MAX_EXPIRY_DAYS}.`)
      }
      expiresAt = new Date(Date.now() + days * 86_400_000).toISOString()
    }

    const { key, record } = await createApiKey(c.env.DB, { userId: principal.userId, name, scopes, expiresAt })
    await logActivity(c.env.DB, {
      userId: principal.userId,
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: record.id,
      details: { name, scopes },
      ipAddress: c.req.header('cf-connecting-ip'),
    })
    // The only time the key is ever returned.
    return c.json({ key, record }, 201)
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

meRoutes.delete('/api-keys/:id', requirePermission('apikeys:manage'), async (c) => {
  const principal = c.get('principal')!
  const id = c.req.param('id')
  if (!(await revokeApiKey(c.env.DB, principal.userId, id))) return c.json({ error: 'not_found' }, 404)
  await logActivity(c.env.DB, {
    userId: principal.userId,
    action: 'api_key.revoked',
    targetType: 'api_key',
    targetId: id,
    ipAddress: c.req.header('cf-connecting-ip'),
  })
  return c.body(null, 204)
})

interface SessionRow {
  id: string
  user_agent: string | null
  ip_address: string | null
  created_at: string
  updated_at: string
}

/**
 * Where you're signed in. Our own list, by session id: Better Auth's list-sessions hands every
 * session's token to page JavaScript, which would undo keeping the cookie out of its reach.
 */
meRoutes.get('/sessions', async (c) => {
  const principal = c.get('principal')!
  if (principal.via !== 'session') return c.json({ error: 'sessions_need_a_session' }, 400)
  const { results } = await c.env.DB.prepare(
    'SELECT id, user_agent, ip_address, created_at, updated_at FROM session WHERE user_id = ? AND expires_at > ? ORDER BY updated_at DESC',
  )
    .bind(principal.userId, nowIso())
    .all<SessionRow>()
  return c.json({
    sessions: results.map((s) => ({
      id: s.id,
      userAgent: s.user_agent,
      ipAddress: s.ip_address,
      signedInAt: s.created_at,
      lastActiveAt: s.updated_at,
      current: s.id === principal.sessionId,
    })),
  })
})

/** Sign out one other browser. This one signs out with the Sign out button. */
meRoutes.delete('/sessions/:id', async (c) => {
  const principal = c.get('principal')!
  const id = c.req.param('id')
  if (principal.via !== 'session') return c.json({ error: 'sessions_need_a_session' }, 400)
  if (id === principal.sessionId) return c.json({ error: 'current_session', message: 'Use Sign out for this browser.' }, 409)
  const result = await c.env.DB.prepare('DELETE FROM session WHERE id = ? AND user_id = ?').bind(id, principal.userId).run()
  if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404)
  await logActivity(c.env.DB, { userId: principal.userId, action: 'account.session_ended', targetType: 'session', targetId: id, ipAddress: c.req.header('cf-connecting-ip') })
  return c.body(null, 204)
})

meRoutes.post('/sessions/sign-out-others', async (c) => {
  const principal = c.get('principal')!
  if (principal.via !== 'session') return c.json({ error: 'sessions_need_a_session' }, 400)
  const result = await c.env.DB.prepare('DELETE FROM session WHERE user_id = ? AND id != ?').bind(principal.userId, principal.sessionId!).run()
  await logActivity(c.env.DB, {
    userId: principal.userId,
    action: 'account.signed_out_elsewhere',
    targetType: 'user',
    targetId: principal.userId,
    details: { sessions: result.meta.changes },
    ipAddress: c.req.header('cf-connecting-ip'),
  })
  return c.json({ ended: result.meta.changes })
})
