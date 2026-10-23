/**
 * First-run setup: create the first administrator, or bring a catalog back from a backup
 * (catalog/restore.ts) and choose the sign-in to it.
 *
 * Open only while setup is needed (auth/setup-state.ts). Anywhere but localhost it also needs the
 * SETUP_TOKEN secret, so whoever finds a fresh deployment's URL first can't claim it.
 */
import { Hono, type Context } from 'hono'
import { createAuth } from '../auth/auth'
import { consumeRateLimit, SETUP_RULE } from '../auth/rate-limit'
import { hashPassword } from '../auth/password'
import { startPreviewCheck } from '../catalog/previews'
import { currentRestore, finishRestore, listBackups, parseSource, sourceProvider, startRestore } from '../catalog/restore'
import type { DamEnv } from '../env'
import { asLanguage, type Language } from '@cf-dam/i18n'
import { savePreferences } from '../catalog/preferences'
import { logActivity } from '../lib/activity'
import { setSiteLanguage } from '../lib/language'
import { timingSafeEqual } from '../lib/crypto'
import { BadRequest, isLocalRequest, readJsonObject, requiredEmail, requiredString } from '../lib/http'
import { markSetupDone, setupNeeded } from '../auth/setup-state'

export { resetSetupCacheForTests, setupNeeded } from '../auth/setup-state'

export const setupRoutes = new Hono<DamEnv>()

setupRoutes.get('/', async (c) => {
  const needed = await setupNeeded(c.env.DB)
  const tokenConfigured = Boolean(c.env.SETUP_TOKEN)
  return c.json({
    needed,
    tokenRequired: tokenConfigured || !isLocalRequest(c.req.raw),
    // A deployment with no SETUP_TOKEN can't be set up from outside localhost.
    blocked: needed && !tokenConfigured && !isLocalRequest(c.req.raw),
    restore: needed ? await currentRestore(c.env.DB) : null,
  })
})

/**
 * Every setup action: rate-limited, only while setup is needed, and with the setup token. Returns the
 * request body, or the refusal to send.
 */
async function guarded(c: Context<DamEnv>): Promise<{ body: Record<string, unknown>; refusal?: never } | { refusal: Response; body?: never }> {
  const limited = await consumeRateLimit(c, SETUP_RULE)
  if (limited) return { refusal: limited }
  if (!(await setupNeeded(c.env.DB))) return { refusal: c.json({ error: 'already_set_up' }, 409) }
  const body = await readJsonObject(c)
  const token = c.env.SETUP_TOKEN
  if (token) {
    const presented = typeof body.token === 'string' ? body.token : ''
    if (!timingSafeEqual(presented, token)) return { refusal: c.json({ error: 'invalid_setup_token' }, 403) }
  } else if (!isLocalRequest(c.req.raw)) {
    return { refusal: c.json({ error: 'setup_token_not_configured' }, 403) }
  }
  return { body }
}

/** A new administrator, signed in by the response's cookie. */
async function signUpAdmin(c: Context<DamEnv>, name: string, email: string, password: string): Promise<Response> {
  const auth = createAuth(c.env, c.req.raw, { allowSignUp: true, role: 'admin' })
  // asResponse: Better Auth's response carries the new session cookie, so the admin is signed in.
  return auth.api.signUpEmail({ body: { name, email, password }, headers: c.req.raw.headers, asResponse: true })
}

setupRoutes.post('/', async (c) => {
  try {
    const { body, refusal } = await guarded(c)
    if (refusal) return refusal
    if (await currentRestore(c.env.DB)) return c.json({ error: 'restore_in_progress', message: 'A backup is being restored: finish that instead.' }, 409)

    const name = requiredString(body, 'name')
    const email = requiredEmail(body)
    const password = requiredString(body, 'password', 256)
    const language = asLanguage(body.language) as Language | null
    const response = await signUpAdmin(c, name, email, password)
    if (response.ok) {
      markSetupDone()
      // The archive's language, chosen on the setup page; the first administrator's own too.
      if (language) {
        await setSiteLanguage(c.env.DB, language)
        const admin = await c.env.DB.prepare('SELECT id FROM users WHERE lower(email) = ?').bind(email).first<{ id: string }>()
        if (admin) await savePreferences(c.env.DB, admin.id, { language })
      }
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

/** The finished backups in a bucket, to choose from. */
setupRoutes.post('/restore/backups', async (c) => {
  try {
    const { body, refusal } = await guarded(c)
    if (refusal) return refusal
    const backups = await listBackups(sourceProvider(c.env, parseSource(body))).catch((error) => {
      throw new BadRequest(`Couldn't look in that bucket: ${error instanceof Error ? error.message : String(error)}`)
    })
    return c.json({ backups })
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

/** Start loading one (or carry on with one that failed part-way). The sweep does the work. */
setupRoutes.post('/restore', async (c) => {
  try {
    const { body, refusal } = await guarded(c)
    if (refusal) return refusal
    const restore = await startRestore(c.env, parseSource(body), requiredString(body, 'backupId', 100))
    return c.json({ restore }, 202)
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

/** Loaded: the person restoring chooses their sign-in, and is signed in. */
setupRoutes.post('/restore/finish', async (c) => {
  try {
    const { body, refusal } = await guarded(c)
    if (refusal) return refusal
    const name = requiredString(body, 'name')
    const email = requiredEmail(body)
    const password = requiredString(body, 'password', 256)
    if (password.length < 12) throw new BadRequest('password must be at least 12 characters.')
    const { userId, existing } = await finishRestore(c.env.DB, hashPassword, { name, email, password })
    markSetupDone()
    // Previews aren't in backups: into a new account, they're all to make again.
    await startPreviewCheck(c.env.DB)
    const response = existing
      ? await createAuth(c.env, c.req.raw).api.signInEmail({ body: { email, password }, headers: c.req.raw.headers, asResponse: true })
      : await signUpAdmin(c, name, email, password)
    await logActivity(c.env.DB, {
      userId,
      action: 'setup.restored',
      targetType: 'user',
      targetId: userId ?? undefined,
      details: { email, existing },
      ipAddress: c.req.header('cf-connecting-ip'),
    })
    return response
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})
