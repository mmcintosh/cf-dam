/**
 * Per-IP rate limiting on KV, for the auth endpoints (ported from Infowall).
 *
 * Two properties matter and are easy to "simplify" away:
 *  1. The decision comes from the READ, and rejecting writes nothing. KV allows one write per
 *     second per key; a limiter that increments first fails open under exactly the burst it is
 *     meant to stop.
 *  2. The increment is best-effort. A failed write is logged and never changes a decision.
 * KV is eventually consistent across locations, so a distributed burst is under-counted for up
 * to a minute. Edge rate-limiting rules stay the primary flood defence; this is the backstop.
 */
import type { Context } from 'hono'
import type { DamEnv } from '../env'

export interface RateLimitRule {
  max: number
  windowMs: number
  keyPrefix: string
}

interface Entry {
  count: number
  resetAt: number
}

const MINUTE = 60_000

export async function consumeRateLimit(c: Context<DamEnv>, rule: RateLimitRule): Promise<Response | null> {
  const kv = c.env.CACHE_KV
  // Every request from the internet carries cf-connecting-ip. No IP means a service binding or a
  // test; metering those would put every caller behind one bucket.
  const ip = c.req.header('cf-connecting-ip')
  if (!kv || !ip) return null

  const key = `ratelimit:${rule.keyPrefix}:${ip}`
  const now = Date.now()
  let entry: Entry | null = null
  try {
    entry = await kv.get<Entry>(key, 'json')
  } catch (error) {
    console.warn('[rate-limit] read failed; allowing', error)
    return null
  }
  const current = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + rule.windowMs }

  if (current.count >= rule.max) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    return c.json({ error: 'rate_limited', retryAfter }, 429, { 'Retry-After': String(retryAfter) })
  }

  try {
    const ttl = Math.max(60, Math.ceil((current.resetAt - now) / 1000))
    await kv.put(key, JSON.stringify({ count: current.count + 1, resetAt: current.resetAt }), { expirationTtl: ttl })
  } catch (error) {
    console.warn('[rate-limit] increment failed (decision unchanged)', error)
  }
  return null
}

const CREDENTIAL_SIGN_IN: RateLimitRule = { max: 5, windowMs: MINUTE, keyPrefix: 'sign-in' }
const ACCOUNT_CREATION: RateLimitRule = { max: 3, windowMs: MINUTE, keyPrefix: 'sign-up' }
const EMAIL_SEND: RateLimitRule = { max: 3, windowMs: MINUTE, keyPrefix: 'email-send' }
const CODE_VERIFY: RateLimitRule = { max: 5, windowMs: MINUTE, keyPrefix: 'code-verify' }
const ACCOUNT_CHANGE: RateLimitRule = { max: 5, windowMs: MINUTE, keyPrefix: 'account-change' }
// Each passkey challenge writes a row; the sign-in page asks for one on load (for autofill).
const PASSKEY_CHALLENGE: RateLimitRule = { max: 20, windowMs: MINUTE, keyPrefix: 'passkey-challenge' }

/**
 * Metered Better Auth paths, matched EXACTLY: `/sign-in/email-otp` starts with `/sign-in/email`,
 * so a prefix match would give it the wrong budget. `/get-session` is deliberately unmetered
 * (it runs on every page load), as are verifiers of long random tokens, which can't be guessed.
 */
const AUTH_RULES: ReadonlyMap<string, RateLimitRule> = new Map([
  ['/sign-in/email', CREDENTIAL_SIGN_IN],
  ['/sign-up/email', ACCOUNT_CREATION],
  ['/forget-password', EMAIL_SEND],
  ['/request-password-reset', EMAIL_SEND],
  ['/send-verification-email', EMAIL_SEND],
  ['/two-factor/send-otp', EMAIL_SEND],
  ['/two-factor/verify-totp', CODE_VERIFY],
  ['/two-factor/verify-otp', CODE_VERIFY],
  ['/two-factor/verify-backup-code', CODE_VERIFY],
  ['/change-password', ACCOUNT_CHANGE],
  ['/change-email', ACCOUNT_CHANGE],
  ['/passkey/generate-authenticate-options', PASSKEY_CHALLENGE],
  ['/passkey/verify-authentication', CREDENTIAL_SIGN_IN],
  ['/passkey/generate-register-options', ACCOUNT_CHANGE],
  ['/passkey/verify-registration', ACCOUNT_CHANGE],
])

/** The rule for a path under `/api/auth`, or null when unmetered. One trailing slash is tolerated. */
export function authRateLimitRule(path: string, basePath = '/api/auth'): RateLimitRule | null {
  if (!path.startsWith(basePath)) return null
  let sub = path.slice(basePath.length)
  if (sub.length > 1 && sub.endsWith('/')) sub = sub.slice(0, -1)
  return AUTH_RULES.get(sub) ?? null
}

export const SETUP_RULE: RateLimitRule = { max: 5, windowMs: MINUTE, keyPrefix: 'setup' }
