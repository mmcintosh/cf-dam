/**
 * Setup → Email (plans/PLAN-E-v2.md §5): whether this install can send, the studio's name and reply address, turning
 * email on, and a test email sent at once. Administrators (`settings:manage`).
 */
import { Hono } from 'hono'
import { currentLanguage } from '@cf-dam/i18n'
import { requirePermission } from '../auth/principal'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { readJsonObject } from '../lib/http'
import { say } from '../lib/language'
import { mailAvailable } from '../mail/mailer'
import { getMailSettings, mailReady, mailStatus, saveMailSettings, sendTestMail } from '../mail/outbox'

export const mailRoutes = new Hono<DamEnv>()

mailRoutes.use('*', requirePermission('settings:manage'))

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The address this request came to: what links would be built from if email were turned on now. */
const here = (url: string) => new URL(url).origin

mailRoutes.get('/', async (c) => {
  const settings = await getMailSettings(c.env.DB)
  return c.json({
    available: mailAvailable(c.env),
    from: c.env.MAIL_FROM ?? null,
    allowTo: c.env.MAIL_ALLOW_TO ?? null,
    ready: mailReady(c.env, settings),
    here: here(c.req.url),
    settings,
    status: await mailStatus(c.env.DB),
  })
})

mailRoutes.put('/', async (c) => {
  const body = await readJsonObject(c)
  const current = await getMailSettings(c.env.DB)
  const { stopped: _stopped, ...next } = current
  if (body.studio !== undefined) {
    if (typeof body.studio !== 'string' || !body.studio.trim() || body.studio.length > 80) return c.json({ error: 'invalid_request', message: say('mailPage.err.studio') }, 400)
    next.studio = body.studio.replace(/[\r\n]+/g, ' ').trim()
  }
  if (body.replyTo !== undefined) {
    const replyTo = typeof body.replyTo === 'string' ? body.replyTo.trim().toLowerCase() : ''
    if (replyTo && (!EMAIL.test(replyTo) || replyTo.length > 254)) return c.json({ error: 'invalid_request', message: say('mailPage.err.replyTo') }, 400)
    next.replyTo = replyTo
  }
  if (body.on !== undefined) {
    if (body.on === true && !mailAvailable(c.env)) return c.json({ error: 'mail_unavailable', message: say('mailPage.err.unavailable') }, 409)
    next.on = body.on === true
    // Links are built from the address email was turned on at, never from whichever request later queues a message.
    if (next.on) next.origin = here(c.req.url)
  }
  await saveMailSettings(c.env.DB, next)
  await logActivity(c.env.DB, {
    userId: c.get('principal')!.userId,
    action: 'mail.settings_changed',
    details: { on: next.on, origin: next.origin, studio: next.studio, replyTo: Boolean(next.replyTo) },
    ipAddress: c.req.header('cf-connecting-ip'),
  })
  return c.json({ settings: await getMailSettings(c.env.DB) })
})

mailRoutes.post('/test', async (c) => {
  if (!mailAvailable(c.env)) return c.json({ error: 'mail_unavailable', message: say('mailPage.err.unavailable') }, 409)
  const principal = c.get('principal')!
  const outcome = await sendTestMail(c.env, principal.email, currentLanguage(), here(c.req.url))
  await logActivity(c.env.DB, { userId: principal.userId, action: 'mail.test', details: { ok: outcome.ok, ...(outcome.ok ? {} : { code: outcome.code }) }, ipAddress: c.req.header('cf-connecting-ip') })
  return outcome.ok ? c.json({ ok: true, to: principal.email }) : c.json({ ok: false, to: principal.email, code: outcome.code, message: outcome.message }, 502)
})
