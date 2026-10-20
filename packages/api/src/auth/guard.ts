/**
 * Our side of Better Auth's endpoints, around its handler: the per-IP limit, the per-account password
 * lockout, and activity entries for failed sign-ins and account changes. (Successful sign-ins are
 * logged where the session is made, in auth.ts, which also sees passkey and two-step sign-ins.)
 *
 * The lockout counts responses rather than hooking Better Auth's internals: a 401 from the password
 * sign-in is a wrong password for an account that exists (unknown emails aren't counted, so the lock
 * reveals an account only after ten tries, from IPs already held to five a minute). A passkey still
 * signs in while passwords are locked, so a stranger can't lock the owner out.
 */
import type { Context } from 'hono'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { nowIso } from '../lib/time'
import { createAuth } from './auth'
import { REQUIRE_2FA_KEY, resolvePrincipal, twoFactorRequired } from './principal'
import { authRateLimitRule, authSubPath, consumeRateLimit } from './rate-limit'

export const LOCKOUT = { maxFailures: 10, minutes: 15 }

/** Account changes made through Better Auth, logged when they succeed for a signed-in person. */
const ACCOUNT_CHANGES: ReadonlyMap<string, string> = new Map([
  ['/change-password', 'account.password_changed'],
  // Signed in, this only completes turning codes on; signing in with a code has no session yet.
  ['/two-factor/verify-totp', 'account.two_factor_on'],
  ['/two-factor/disable', 'account.two_factor_off'],
  ['/passkey/verify-registration', 'account.passkey_added'],
  ['/passkey/delete-passkey', 'account.passkey_removed'],
])

interface LockRow {
  id: string
  locked_until: string | null
}

export async function handleAuthRequest(c: Context<DamEnv>): Promise<Response> {
  const rule = authRateLimitRule(c.req.path)
  if (rule) {
    const limited = await consumeRateLimit(c, rule)
    if (limited) return limited
  }
  const auth = createAuth(c.env, c.req.raw)
  const sub = authSubPath(c.req.path)
  if (sub === '/sign-in/email' && c.req.method === 'POST') return passwordSignIn(c, auth)

  if (sub === '/change-password' && c.req.method === 'POST') {
    const body = await c.req.raw
      .clone()
      .json<{ currentPassword?: unknown; newPassword?: unknown }>()
      .catch(() => null)
    // A temporary password has to be replaced, not confirmed.
    if (typeof body?.newPassword === 'string' && body.newPassword === body.currentPassword) {
      return c.json({ code: 'SAME_PASSWORD', message: 'Choose a password different from the current one.' }, 400)
    }
  }

  const change = sub ? ACCOUNT_CHANGES.get(sub) : undefined
  // Who it is, before the handler: changing a password can end the very session that asked.
  const before = change ? await resolvePrincipal(c.env, c.req.raw) : null
  const response = await auth.handler(c.req.raw)
  if (change && before?.via === 'session' && response.ok) {
    if (sub === '/change-password') {
      await c.env.DB.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').bind(before.userId).run()
    }
    await logActivity(c.env.DB, { userId: before.userId, action: change, targetType: 'user', targetId: before.userId, ipAddress: c.req.header('cf-connecting-ip') })
  }
  return response
}

interface PolicyRow {
  two_factor_enabled: number
  passkeys: number
  scope: string | null
  is_admin: number
}

/**
 * Where two factors are required, a password alone is never enough. Someone with codes on is asked
 * for one by Better Auth; someone whose only second factor is a passkey must use the passkey. Checked
 * after the password, so it says nothing about the account to someone who doesn't know it.
 */
async function passkeyRequired(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT u.two_factor_enabled,
              (SELECT COUNT(*) FROM passkey p WHERE p.user_id = u.id) AS passkeys,
              (SELECT value FROM settings WHERE key = '${REQUIRE_2FA_KEY}') AS scope,
              EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = 'admin') AS is_admin
       FROM users u WHERE u.id = ?`,
    )
    .bind(userId)
    .first<PolicyRow>()
  if (!row || row.two_factor_enabled === 1 || row.passkeys === 0) return false
  return twoFactorRequired(row.scope, row.is_admin === 1 ? ['admin'] : [])
}

async function passwordSignIn(c: Context<DamEnv>, auth: ReturnType<typeof createAuth>): Promise<Response> {
  const db = c.env.DB
  const body = await c.req.raw
    .clone()
    .json<{ email?: unknown }>()
    .catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const user = email ? await db.prepare('SELECT id, locked_until FROM users WHERE email = ?').bind(email).first<LockRow>() : null
  const ip = c.req.header('cf-connecting-ip')

  if (user?.locked_until && user.locked_until > nowIso()) {
    const minutes = Math.max(1, Math.ceil((Date.parse(user.locked_until) - Date.now()) / 60_000))
    return c.json(
      {
        code: 'ACCOUNT_LOCKED',
        message: `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, sign in with a passkey, or ask an administrator to unlock it.`,
      },
      403,
    )
  }

  const response = await auth.handler(c.req.raw)
  if (!user) return response
  if (response.status === 401) {
    // Counted in the database, not from the value read above, so attempts racing each other all count.
    const row = await db
      .prepare('UPDATE users SET failed_sign_ins = failed_sign_ins + 1 WHERE id = ? RETURNING failed_sign_ins')
      .bind(user.id)
      .first<{ failed_sign_ins: number }>()
    const failures = row?.failed_sign_ins ?? 0
    await logActivity(db, { userId: user.id, action: 'auth.sign_in_failed', targetType: 'user', targetId: user.id, details: { failures }, ipAddress: ip })
    if (failures >= LOCKOUT.maxFailures) {
      const until = new Date(Date.now() + LOCKOUT.minutes * 60_000).toISOString()
      await db.prepare('UPDATE users SET failed_sign_ins = 0, locked_until = ? WHERE id = ?').bind(until, user.id).run()
      await logActivity(db, { userId: user.id, action: 'auth.locked', targetType: 'user', targetId: user.id, details: { until }, ipAddress: ip })
    }
  } else if (response.ok) {
    // The password was right (with or without a code still to come): the count starts again.
    await db.prepare('UPDATE users SET failed_sign_ins = 0, locked_until = NULL WHERE id = ? AND (failed_sign_ins > 0 OR locked_until IS NOT NULL)').bind(user.id).run()
    const signedIn = await response
      .clone()
      .json<{ token?: unknown }>()
      .catch(() => null)
    if (typeof signedIn?.token === 'string' && (await passkeyRequired(db, user.id))) {
      // The session Better Auth just made is withdrawn, and its cookie never sent.
      await db.prepare('DELETE FROM session WHERE token = ?').bind(signedIn.token).run()
      await logActivity(db, { userId: user.id, action: 'auth.passkey_required', targetType: 'user', targetId: user.id, ipAddress: ip })
      return c.json({ code: 'USE_PASSKEY', message: 'This account signs in with a passkey. Choose "Sign in with a passkey".' }, 403)
    }
  }
  return response
}
