/**
 * Who is making this request, and what may they do.
 *
 * Two ways in: an API key (`Authorization: Bearer cfdam_…` or `X-API-Key`) for programs, or a
 * Better Auth session cookie for people. Either way the result is a `Principal` with the user's
 * roles and effective permissions. An API key never exceeds its owner: its permissions are the
 * owner's permissions intersected with the key's scopes.
 */
import type { MiddlewareHandler } from 'hono'
import type { DamBindings, DamEnv } from '../env'
import { findLiveApiKey, looksLikeApiKey, touchApiKey } from './api-keys'
import { createAuth } from './auth'
import { loadGrants } from './roles'

export interface Principal {
  userId: string
  email: string
  name: string
  roles: string[]
  permissions: Set<string>
  via: 'session' | 'api_key'
  apiKeyId?: string
}

interface ActiveUserRow {
  id: string
  email: string
  name: string
  is_active: number
}

function presentedApiKey(request: Request): string | null {
  const header = request.headers.get('X-API-Key')
  if (header) return header.trim()
  const authorization = request.headers.get('Authorization')
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim()
    if (looksLikeApiKey(token)) return token
  }
  return null
}

async function activeUser(db: D1Database, userId: string): Promise<ActiveUserRow | null> {
  const row = await db
    .prepare('SELECT id, email, name, is_active FROM users WHERE id = ?')
    .bind(userId)
    .first<ActiveUserRow>()
  return row && row.is_active === 1 ? row : null
}

/**
 * Resolve the request's principal, or null when it carries no valid credential. An API key that
 * is presented but invalid resolves to null; it never falls back to the session cookie.
 */
export async function resolvePrincipal(
  env: DamBindings,
  request: Request,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Principal | null> {
  const key = presentedApiKey(request)
  if (key !== null) {
    const record = await findLiveApiKey(env.DB, key)
    if (!record) return null
    const user = await activeUser(env.DB, record.userId)
    if (!user) return null
    const grants = await loadGrants(env.DB, user.id)
    const scopes = new Set(record.scopes)
    waitUntil?.(touchApiKey(env.DB, record.id))
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      roles: grants.roles,
      permissions: new Set([...grants.permissions].filter((p) => scopes.has(p))),
      via: 'api_key',
      apiKeyId: record.id,
    }
  }

  const session = await createAuth(env, request).api.getSession({ headers: request.headers })
  if (!session) return null
  // getSession doesn't re-check our is_active flag, so deactivating a user takes effect on their
  // next request rather than when their session expires.
  const user = await activeUser(env.DB, session.user.id)
  if (!user) return null
  const grants = await loadGrants(env.DB, user.id)
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    roles: grants.roles,
    permissions: grants.permissions,
    via: 'session',
  }
}

/** Sets `principal` when the request is authenticated; never rejects. */
export const authenticate = (): MiddlewareHandler<DamEnv> => async (c, next) => {
  const principal = await resolvePrincipal(c.env, c.req.raw, (p) => c.executionCtx.waitUntil(p))
  if (principal) c.set('principal', principal)
  await next()
}

export const requireAuth = (): MiddlewareHandler<DamEnv> => async (c, next) => {
  if (!c.get('principal')) return c.json({ error: 'unauthenticated' }, 401)
  await next()
}

export const requirePermission =
  (permission: string): MiddlewareHandler<DamEnv> =>
  async (c, next) => {
    const principal = c.get('principal')
    if (!principal) return c.json({ error: 'unauthenticated' }, 401)
    if (!principal.permissions.has(permission)) return c.json({ error: 'forbidden', permission }, 403)
    await next()
  }

/** The JSON shape of a principal (Sets don't serialise). */
export function principalJson(principal: Principal) {
  return {
    id: principal.userId,
    email: principal.email,
    name: principal.name,
    roles: principal.roles,
    permissions: [...principal.permissions].sort(),
    via: principal.via,
  }
}
