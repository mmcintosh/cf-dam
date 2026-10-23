/** User administration. Everything here needs `users:manage`. */
import { Hono, type Context } from 'hono'
import { createAuth } from '../auth/auth'
import { hashPassword } from '../auth/password'
import { REQUIRE_2FA_KEY, requirePermission, TWO_FACTOR_SCOPES, twoFactorRequired, type TwoFactorScope } from '../auth/principal'
import { isLastActiveAdmin, listRoles, setUserRoles } from '../auth/roles'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { randomId } from '../lib/crypto'
import { BadRequest, optionalString, readJsonObject, requiredEmail, requiredString, stringArray } from '../lib/http'
import { nowIso } from '../lib/time'
import { say } from '../lib/language'

interface UserRow {
  id: string
  name: string
  email: string
  is_active: number
  two_factor_enabled: number
  must_change_password: number
  locked_until: string | null
  last_login_at: string | null
  created_at: string
  roles: string | null
  passkeys: number
  sessions: number
}

const USER_SELECT = `
  SELECT u.id, u.name, u.email, u.is_active, u.two_factor_enabled, u.must_change_password, u.locked_until,
         u.last_login_at, u.created_at, group_concat(r.name) AS roles,
         (SELECT COUNT(*) FROM passkey p WHERE p.user_id = u.id) AS passkeys,
         (SELECT COUNT(*) FROM session s WHERE s.user_id = u.id AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS sessions
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id`

function userJson(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isActive: row.is_active === 1,
    twoFactorEnabled: row.two_factor_enabled === 1,
    passkeys: row.passkeys,
    sessions: row.sessions,
    mustChangePassword: row.must_change_password === 1,
    lockedUntil: row.locked_until && row.locked_until > new Date().toISOString() ? row.locked_until : null,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    roles: row.roles ? row.roles.split(',').sort() : [],
  }
}

async function getUser(db: D1Database, id: string) {
  const row = await db.prepare(`${USER_SELECT} WHERE u.id = ? GROUP BY u.id`).bind(id).first<UserRow>()
  return row ? userJson(row) : null
}

async function validRoleNames(db: D1Database, names: string[]): Promise<string[]> {
  const known = new Set((await listRoles(db)).map((r) => r.name))
  const unknown = names.filter((n) => !known.has(n))
  if (unknown.length > 0) throw new BadRequest(say('err.unknownRoles', { roles: unknown.join(', ') }))
  return names
}

export const userRoutes = new Hono<DamEnv>()
export const roleRoutes = new Hono<DamEnv>()

roleRoutes.get('/', requirePermission('users:manage'), async (c) => c.json({ roles: await listRoles(c.env.DB) }))

userRoutes.use('*', requirePermission('users:manage'))

/** Who must sign in with two factors (a code or a passkey). */
userRoutes.get('/policy', async (c) => {
  const row = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(REQUIRE_2FA_KEY).first<{ value: string }>()
  return c.json({ twoFactorRequiredFor: (row?.value ?? 'nobody') as TwoFactorScope })
})

userRoutes.put('/policy', async (c) => {
  const actor = c.get('principal')!
  try {
    const scope = (await readJsonObject(c)).twoFactorRequiredFor
    if (typeof scope !== 'string' || !TWO_FACTOR_SCOPES.includes(scope as TwoFactorScope)) {
      throw new BadRequest(`twoFactorRequiredFor must be one of: ${TWO_FACTOR_SCOPES.join(', ')}.`)
    }
    // Whoever turns it on must already meet it, or the next request would lock them into setup.
    if (twoFactorRequired(scope, actor.roles)) {
      const me = await getUser(c.env.DB, actor.userId)
      if (me && !me.twoFactorEnabled && me.passkeys === 0) {
        return c.json({ error: 'set_up_yourself', message: say('err.setUpYourself') }, 409)
      }
    }
    await c.env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .bind(REQUIRE_2FA_KEY, scope, nowIso())
      .run()
    await logActivity(c.env.DB, { userId: actor.userId, action: 'policy.two_factor', details: { requiredFor: scope }, ipAddress: c.req.header('cf-connecting-ip') })
    return c.json({ twoFactorRequiredFor: scope })
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

userRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`${USER_SELECT} GROUP BY u.id ORDER BY u.created_at`).all<UserRow>()
  return c.json({ users: results.map(userJson) })
})

userRoutes.post('/', async (c) => {
  const actor = c.get('principal')!
  try {
    const body = await readJsonObject(c)
    const name = requiredString(body, 'name')
    const email = requiredEmail(body)
    const password = requiredString(body, 'password', 256)
    if (password.length < 12) throw new BadRequest(say('err.passwordShort'))
    const roles = await validRoleNames(c.env.DB, stringArray(body, 'roles') ?? ['viewer'])
    if (roles.length === 0) throw new BadRequest(say('err.needRole'))

    const auth = createAuth(c.env, c.req.raw, { allowSignUp: true, role: roles[0] })
    const ctx = await auth.$context
    if (await ctx.internalAdapter.findUserByEmail(email)) return c.json({ error: 'email_taken' }, 409)
    // The internal adapter runs the same database hooks as sign-up, without signing the new user
    // in as a side effect of an admin creating them.
    const user = await ctx.internalAdapter.createUser({ name, email, emailVerified: false }, { method: 'email-password' })
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(password),
    })
    await setUserRoles(c.env.DB, user.id, roles)
    // The admin chose this password, so it's theirs to know: the person picks their own first.
    await c.env.DB.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').bind(user.id).run()

    await logActivity(c.env.DB, {
      userId: actor.userId,
      action: 'user.created',
      targetType: 'user',
      targetId: user.id,
      details: { email, roles },
      ipAddress: c.req.header('cf-connecting-ip'),
    })
    return c.json({ user: await getUser(c.env.DB, user.id) }, 201)
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

userRoutes.patch('/:id', async (c) => {
  const actor = c.get('principal')!
  const id = c.req.param('id')
  const existing = await getUser(c.env.DB, id)
  if (!existing) return c.json({ error: 'not_found' }, 404)

  try {
    const body = await readJsonObject(c)
    const name = optionalString(body, 'name')
    const roleNames = stringArray(body, 'roles')
    const isActive = body.isActive
    if (isActive !== undefined && typeof isActive !== 'boolean') throw new BadRequest('isActive must be true or false.')

    const losingAdmin =
      existing.roles.includes('admin') &&
      ((roleNames !== undefined && !roleNames.includes('admin')) || isActive === false)
    if (losingAdmin && (await isLastActiveAdmin(c.env.DB, id))) {
      return c.json({ error: 'last_admin', message: say('err.lastAdmin') }, 409)
    }

    if (roleNames !== undefined) {
      if (roleNames.length === 0) throw new BadRequest(say('err.needRole'))
      await setUserRoles(c.env.DB, id, await validRoleNames(c.env.DB, roleNames))
    }
    if (name !== undefined) {
      await c.env.DB.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').bind(name, nowIso(), id).run()
    }
    if (isActive !== undefined) {
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').bind(isActive ? 1 : 0, nowIso(), id),
        // Deactivation ends every session now rather than when each one expires.
        ...(isActive ? [] : [c.env.DB.prepare('DELETE FROM session WHERE user_id = ?').bind(id)]),
      ])
    }

    await logActivity(c.env.DB, {
      userId: actor.userId,
      action: 'user.updated',
      targetType: 'user',
      targetId: id,
      details: { name, roles: roleNames, isActive },
      ipAddress: c.req.header('cf-connecting-ip'),
    })
    return c.json({ user: await getUser(c.env.DB, id) })
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

/**
 * Recovery for someone else. Each one signs the person out everywhere, and none works on yourself:
 * your own password, codes, passkeys and sessions are on Account, behind your own sign-in.
 */
async function otherUser(c: Context<DamEnv>) {
  const id = c.req.param('id')!
  if (id === c.get('principal')!.userId) return { error: c.json({ error: 'yourself', message: say('err.useAccount') }, 409) }
  const user = await getUser(c.env.DB, id)
  if (!user) return { error: c.json({ error: 'not_found' }, 404) }
  return { user }
}

function endSessions(db: D1Database, userId: string): D1PreparedStatement {
  return db.prepare('DELETE FROM session WHERE user_id = ?').bind(userId)
}

async function logged(c: Context<DamEnv>, action: string, user: { id: string; email: string }, details: Record<string, unknown> = {}) {
  await logActivity(c.env.DB, {
    userId: c.get('principal')!.userId,
    action,
    targetType: 'user',
    targetId: user.id,
    details: { email: user.email, ...details },
    ipAddress: c.req.header('cf-connecting-ip'),
  })
}

/** A temporary password: they must change it at their next sign-in. Unlocks password sign-in too. */
userRoutes.post('/:id/password', async (c) => {
  const { user, error } = await otherUser(c)
  if (error) return error
  try {
    const password = requiredString(await readJsonObject(c), 'password', 256)
    if (password.length < 12) throw new BadRequest(say('err.passwordShort'))
    const now = nowIso()
    const db = c.env.DB
    await db.batch([
      // Replaced, not updated: someone restored from a backup has no password yet.
      db.prepare("DELETE FROM account WHERE user_id = ? AND provider_id = 'credential'").bind(user.id),
      db
        .prepare("INSERT INTO account (id, user_id, account_id, provider_id, password, created_at, updated_at) VALUES (?, ?, ?, 'credential', ?, ?, ?)")
        .bind(randomId(), user.id, user.id, await hashPassword(password), now, now),
      db.prepare('UPDATE users SET must_change_password = 1, failed_sign_ins = 0, locked_until = NULL, updated_at = ? WHERE id = ?').bind(now, user.id),
      endSessions(db, user.id),
    ])
    await logged(c, 'user.password_reset', user)
    return c.json({ user: await getUser(db, user.id) })
  } catch (failure) {
    if (failure instanceof BadRequest) return c.json({ error: 'invalid_request', message: failure.message }, 400)
    throw failure
  }
})

/** For a lost phone: codes off (they can turn them on again), and with `passkeys: true` their passkeys removed. */
userRoutes.post('/:id/two-factor/reset', async (c) => {
  const { user, error } = await otherUser(c)
  if (error) return error
  const body = await readJsonObject(c).catch(() => ({}) as Record<string, unknown>)
  const passkeys = body.passkeys === true
  const db = c.env.DB
  await db.batch([
    db.prepare('DELETE FROM two_factor WHERE user_id = ?').bind(user.id),
    db.prepare('UPDATE users SET two_factor_enabled = 0, updated_at = ? WHERE id = ?').bind(nowIso(), user.id),
    ...(passkeys ? [db.prepare('DELETE FROM passkey WHERE user_id = ?').bind(user.id)] : []),
    endSessions(db, user.id),
  ])
  await logged(c, 'user.two_factor_reset', user, { passkeys })
  return c.json({ user: await getUser(db, user.id) })
})

/** Lift a password lockout, and a code lockout, early. */
userRoutes.post('/:id/unlock', async (c) => {
  const { user, error } = await otherUser(c)
  if (error) return error
  const db = c.env.DB
  await db.batch([
    db.prepare('UPDATE users SET failed_sign_ins = 0, locked_until = NULL WHERE id = ?').bind(user.id),
    db.prepare('UPDATE two_factor SET failed_verification_count = 0, locked_until = NULL WHERE user_id = ?').bind(user.id),
  ])
  await logged(c, 'user.unlocked', user)
  return c.json({ user: await getUser(db, user.id) })
})

userRoutes.post('/:id/sign-out', async (c) => {
  const { user, error } = await otherUser(c)
  if (error) return error
  await endSessions(c.env.DB, user.id).run()
  await logged(c, 'user.signed_out', user)
  return c.json({ user: await getUser(c.env.DB, user.id) })
})

/**
 * Delete a person. What they made stays (photos, albums, galleries, agents; "added by" is cleared);
 * their sign-ins, keys, codes and passkeys go with them. The log keeps their email.
 */
userRoutes.delete('/:id', async (c) => {
  const { user, error } = await otherUser(c)
  if (error) return error
  if (user.roles.includes('admin') && (await isLastActiveAdmin(c.env.DB, user.id))) {
    return c.json({ error: 'last_admin', message: say('err.lastAdmin') }, 409)
  }
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run()
  await logged(c, 'user.deleted', user, { name: user.name, roles: user.roles })
  return c.body(null, 204)
})
