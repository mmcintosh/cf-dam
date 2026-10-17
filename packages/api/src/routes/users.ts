/** User administration. Everything here needs `users:manage`. */
import { Hono } from 'hono'
import { createAuth } from '../auth/auth'
import { requirePermission } from '../auth/principal'
import { isLastActiveAdmin, listRoles, setUserRoles } from '../auth/roles'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, optionalString, readJsonObject, requiredEmail, requiredString, stringArray } from '../lib/http'
import { nowIso } from '../lib/time'

interface UserRow {
  id: string
  name: string
  email: string
  is_active: number
  two_factor_enabled: number
  last_login_at: string | null
  created_at: string
  roles: string | null
}

const USER_SELECT = `
  SELECT u.id, u.name, u.email, u.is_active, u.two_factor_enabled, u.last_login_at, u.created_at,
         group_concat(r.name) AS roles
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
  if (unknown.length > 0) throw new BadRequest(`Unknown roles: ${unknown.join(', ')}`)
  return names
}

export const userRoutes = new Hono<DamEnv>()
export const roleRoutes = new Hono<DamEnv>()

roleRoutes.get('/', requirePermission('users:manage'), async (c) => c.json({ roles: await listRoles(c.env.DB) }))

userRoutes.use('*', requirePermission('users:manage'))

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
    if (password.length < 12) throw new BadRequest('password must be at least 12 characters.')
    const roles = await validRoleNames(c.env.DB, stringArray(body, 'roles') ?? ['viewer'])
    if (roles.length === 0) throw new BadRequest('Give the user at least one role.')

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
      return c.json({ error: 'last_admin', message: 'At least one active administrator must remain.' }, 409)
    }

    if (roleNames !== undefined) {
      if (roleNames.length === 0) throw new BadRequest('Give the user at least one role.')
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
