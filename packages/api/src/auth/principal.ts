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
import { sha256Hex } from '../lib/crypto'
import { findLiveApiKey, looksLikeApiKey, touchApiKey } from './api-keys'
import { createAuth } from './auth'
import { loadGrants } from './roles'

/**
 * What a signed-in person must do before anything else: change a temporary password, or set up a
 * second factor (a code or a passkey) where the installation requires one. Until then they can only
 * reach Account: pages redirect there, the API answers 403 `setup_required`, and their API keys
 * don't work at all.
 */
export type SetupStep = 'password' | 'two_factor'

/** Who must sign in with two factors: `settings` key `auth.require_2fa`. A passkey counts as two. */
export type TwoFactorScope = 'nobody' | 'admins' | 'everyone'
export const TWO_FACTOR_SCOPES: readonly TwoFactorScope[] = ['nobody', 'admins', 'everyone']
export const REQUIRE_2FA_KEY = 'auth.require_2fa'

export function twoFactorRequired(scope: string | null, roles: readonly string[]): boolean {
  return scope === 'everyone' || (scope === 'admins' && roles.includes('admin'))
}

export interface Principal {
  setup?: SetupStep
  userId: string
  email: string
  name: string
  roles: string[]
  permissions: Set<string>
  via: 'session' | 'api_key'
  /** The session's id (not its token), for "this browser" in the list of sessions. */
  sessionId?: string
  apiKeyId?: string
  /** Set when the key belongs to a paired NAS agent: it may then only act as that agent. */
  sourceId?: string
}

interface ActiveUserRow {
  id: string
  email: string
  name: string
  is_active: number
  must_change_password: number
  two_factor_enabled: number
  passkeys: number
  require_2fa: string | null
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

/** The user, if active, with what decides their setup step: one query, the rest as sub-selects. */
async function activeUser(db: D1Database, userId: string): Promise<ActiveUserRow | null> {
  const row = await db
    .prepare(
      `SELECT id, email, name, is_active, must_change_password, two_factor_enabled,
              (SELECT COUNT(*) FROM passkey p WHERE p.user_id = users.id) AS passkeys,
              (SELECT value FROM settings WHERE key = '${REQUIRE_2FA_KEY}') AS require_2fa
       FROM users WHERE id = ?`,
    )
    .bind(userId)
    .first<ActiveUserRow>()
  return row && row.is_active === 1 ? row : null
}

function setupStep(user: ActiveUserRow, roles: readonly string[]): SetupStep | null {
  if (user.must_change_password === 1) return 'password'
  const covered = user.two_factor_enabled === 1 || user.passkeys > 0
  return !covered && twoFactorRequired(user.require_2fa, roles) ? 'two_factor' : null
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
    // A NAS agent's key belongs to its source, whoever approved it: it can do exactly one thing, sync
    // as that source. `userId` is the approver's, where they still exist; nothing an agent does uses it.
    const source = await env.DB.prepare('SELECT id, name, created_by FROM sources WHERE key_hash = ? AND revoked_at IS NULL')
      .bind(await sha256Hex(key))
      .first<{ id: string; name: string; created_by: string | null }>()
    if (source) {
      return { userId: source.created_by ?? '', email: '', name: source.name, roles: [], permissions: new Set(['agent:sync']), via: 'api_key', sourceId: source.id }
    }
    const record = await findLiveApiKey(env.DB, key)
    if (!record) return null
    const user = await activeUser(env.DB, record.userId)
    if (!user) return null
    const grants = await loadGrants(env.DB, user.id)
    // A key acts for its owner, and can't finish their setup for them.
    if (setupStep(user, grants.roles)) return null
    waitUntil?.(touchApiKey(env.DB, record.id))
    const scopes = new Set(record.scopes)
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
  const setup = setupStep(user, grants.roles)
  return {
    ...(setup ? { setup } : {}),
    userId: user.id,
    email: user.email,
    name: user.name,
    roles: grants.roles,
    permissions: grants.permissions,
    via: 'session',
    sessionId: session.session.id,
  }
}

/**
 * Sets `principal` when the request is authenticated. Rejects only a person who still has setup to
 * do (see `SetupStep`): they may read `/api/me`, and use `/api/auth`, which is mounted before this.
 */
export const authenticate = (): MiddlewareHandler<DamEnv> => async (c, next) => {
  const principal = await resolvePrincipal(c.env, c.req.raw, (p) => c.executionCtx.waitUntil(p))
  if (principal?.setup && !(c.req.method === 'GET' && c.req.path === '/api/me')) {
    return c.json({ error: 'setup_required', setup: principal.setup }, 403)
  }
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
    setup: principal.setup ?? null,
  }
}
