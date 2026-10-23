/**
 * A client's invite link (catalog/clients.ts): who it's for, and using it to choose a password. No
 * account yet, so this is mounted before sign-in is checked; the token is the key, and it's spent
 * once used. The page then signs them in with the password they chose, as on the sign-in page.
 */
import { Hono } from 'hono'
import { consumeRateLimit } from '../auth/rate-limit'
import { acceptInvite, readInvite } from '../catalog/clients'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject, requiredString } from '../lib/http'
import { say } from '../lib/language'

export const inviteRoutes = new Hono<DamEnv>()

const RULE = { max: 10, windowMs: 60_000, keyPrefix: 'invite' }
const gone = () => ({ error: 'gone', message: say('invite.api.gone') })

inviteRoutes.use('*', async (c, next) => {
  await next()
  c.res.headers.set('Referrer-Policy', 'no-referrer')
  c.res.headers.set('Cache-Control', 'no-store')
})

inviteRoutes.get('/:token', async (c) => {
  const limited = await consumeRateLimit(c, RULE)
  if (limited) return limited
  const invite = await readInvite(c.env.DB, c.req.param('token'))
  return invite ? c.json({ name: invite.name, email: invite.email }) : c.json(gone(), 404)
})

inviteRoutes.post('/:token', async (c) => {
  const limited = await consumeRateLimit(c, RULE)
  if (limited) return limited
  try {
    const password = requiredString(await readJsonObject(c), 'password', 256)
    const joined = await acceptInvite(c.env.DB, c.req.param('token'), password)
    if (!joined) return c.json(gone(), 404)
    await logActivity(c.env.DB, { userId: joined.userId, action: 'client.joined', targetType: 'user', targetId: joined.userId, ipAddress: c.req.header('cf-connecting-ip') })
    return c.json({ email: joined.email })
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})
