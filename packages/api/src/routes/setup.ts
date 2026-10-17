/**
 * First-run setup: create the first administrator.
 *
 * Open only while the database has no users. Anywhere but localhost it also needs the
 * SETUP_TOKEN secret, so whoever finds a fresh deployment's URL first can't claim it.
 */
import { Hono } from 'hono'
import { createAuth } from '../auth/auth'
import { consumeRateLimit, SETUP_RULE } from '../auth/rate-limit'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { timingSafeEqual } from '../lib/crypto'
import { BadRequest, isLocalRequest, readJsonObject, requiredEmail, requiredString } from '../lib/http'

// Once a user exists there is no going back, so remember it for the life of the isolate.
let setupDone = false

export async function setupNeeded(db: D1Database): Promise<boolean> {
  if (setupDone) return false
  const row = await db.prepare('SELECT 1 AS present FROM users LIMIT 1').first<{ present: number }>()
  if (row) setupDone = true
  return !row
}

export const setupRoutes = new Hono<DamEnv>()

setupRoutes.get('/', async (c) => {
  const needed = await setupNeeded(c.env.DB)
  const tokenConfigured = Boolean(c.env.SETUP_TOKEN)
  return c.json({
    needed,
    tokenRequired: tokenConfigured || !isLocalRequest(c.req.raw),
    // A deployment with no SETUP_TOKEN can't be set up from outside localhost.
    blocked: needed && !tokenConfigured && !isLocalRequest(c.req.raw),
  })
})

setupRoutes.post('/', async (c) => {
  const limited = await consumeRateLimit(c, SETUP_RULE)
  if (limited) return limited
  if (!(await setupNeeded(c.env.DB))) return c.json({ error: 'already_set_up' }, 409)

  try {
    const body = await readJsonObject(c)
    const token = c.env.SETUP_TOKEN
    if (token) {
      const presented = typeof body.token === 'string' ? body.token : ''
      if (!timingSafeEqual(presented, token)) return c.json({ error: 'invalid_setup_token' }, 403)
    } else if (!isLocalRequest(c.req.raw)) {
      return c.json({ error: 'setup_token_not_configured' }, 403)
    }

    const name = requiredString(body, 'name')
    const email = requiredEmail(body)
    const password = requiredString(body, 'password', 256)

    const auth = createAuth(c.env, c.req.raw, { allowSignUp: true, role: 'admin' })
    // asResponse: Better Auth's response carries the new session cookie, so the admin is signed in.
    const response = await auth.api.signUpEmail({
      body: { name, email, password },
      headers: c.req.raw.headers,
      asResponse: true,
    })
    if (response.ok) {
      setupDone = true
      await logActivity(c.env.DB, {
        userId: null,
        action: 'setup.admin_created',
        targetType: 'user',
        details: { email },
        ipAddress: c.req.header('cf-connecting-ip'),
      })
    }
    return response
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

/** Test hook: forget the cached "setup done" flag between test databases. */
export function resetSetupCacheForTests(): void {
  setupDone = false
}
