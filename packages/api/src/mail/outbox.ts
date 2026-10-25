/**
 * Every email is queued here and sent from the WORK queue (kind 'mail') or the sweep, never inline
 * (plans/PLAN-E-v2.md §3). Delivery is at least once: a message whose sending was cut short goes back to the queue.
 *
 * Mail is on when the install can send (the MAIL binding and MAIL_FROM), an administrator has turned it on in
 * Setup → Email, and the public address links are built from has been saved there. Without any of these, nothing is
 * queued and nothing breaks.
 *
 * A message's link (a password reset, an invite) is a secret: it's cleared from the row once the message is sent or
 * has failed for good, a message past its link's life is dropped unsent, and the table is left out of backups.
 */
import type { UiLanguage } from '@cf-dam/i18n'
import type { DamBindings } from '../env'
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { nudge } from '../catalog/work'
import { allowedRecipient, mailAvailable, sendMail, type SendOutcome } from './mailer'
import { renderMail, type MailKind, type MailParams } from './templates'

export const MAIL_SETTINGS_KEY = 'mail'
/** Set when the binding says the account or sender is wrong: sending stops until a test email gets through. */
export const MAIL_STOPPED_KEY = 'mail.stopped'

export interface MailSettings {
  /** An administrator turned email on. */
  on: boolean
  /** The public address links are built from (https://…, no path), saved when email was turned on. */
  origin: string | null
  /** The From line's name. */
  studio: string
  /** Replies go here (the studio's real inbox); empty: no Reply-To. */
  replyTo: string
}

export const DEFAULT_MAIL_SETTINGS: MailSettings = { on: false, origin: null, studio: 'cf-dam', replyTo: '' }

export async function getMailSettings(db: D1Database): Promise<MailSettings & { stopped: { code: string; message: string; at: string } | null }> {
  const { results } = await db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?)').bind(MAIL_SETTINGS_KEY, MAIL_STOPPED_KEY).all<{ key: string; value: string }>()
  const read = (key: string) => {
    try {
      const row = results.find((r) => r.key === key)
      return row ? (JSON.parse(row.value) as unknown) : null
    } catch {
      return null
    }
  }
  return { ...DEFAULT_MAIL_SETTINGS, ...((read(MAIL_SETTINGS_KEY) as Partial<MailSettings> | null) ?? {}), stopped: read(MAIL_STOPPED_KEY) as { code: string; message: string; at: string } | null }
}

export async function saveMailSettings(db: D1Database, settings: MailSettings): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(MAIL_SETTINGS_KEY, JSON.stringify(settings), nowIso())
    .run()
}

/** Whether messages may be queued and sent now. */
export const mailReady = (env: Pick<DamBindings, 'MAIL' | 'MAIL_FROM'>, settings: Awaited<ReturnType<typeof getMailSettings>>): boolean =>
  mailAvailable(env) && settings.on && Boolean(settings.origin) && !settings.stopped

/** Messages one queue message sends. */
export const MAIL_CLAIM = 10
/** Tries before a message fails for good. */
const MAX_ATTEMPTS = 3
const RETRY_AFTER_MS = [60_000, 5 * 60_000, 30 * 60_000]
/** A message 'sending' this long was cut short. */
const STUCK_MS = 10 * 60_000
const KEEP_MS = 90 * 86_400_000

export interface QueueMail {
  kind: MailKind
  to: string
  userId?: string | null
  language: UiLanguage
  /** Without `studio`: filled in from the settings when it's sent. */
  params?: Omit<MailParams, 'studio'>
  /** How long the message is worth sending (its link's life). */
  ttlMs?: number
}

/**
 * Queue a message. Returns its id, or null when mail is off (nothing queued). An address not on staging's allow list
 * is recorded as dropped, never sent.
 */
export async function queueMail(env: DamBindings, mail: QueueMail): Promise<string | null> {
  const settings = await getMailSettings(env.DB)
  if (!mailReady(env, settings)) return null
  const id = randomId()
  const now = new Date()
  const allowed = allowedRecipient(env, mail.to)
  await env.DB.prepare(
    `INSERT INTO mail_outbox (id, kind, to_address, user_id, language, params, status, next_attempt_at, expires_at, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      mail.kind,
      mail.to,
      mail.userId ?? null,
      mail.language,
      JSON.stringify(allowed ? (mail.params ?? {}) : {}),
      allowed ? 'queued' : 'dropped',
      now.toISOString(),
      mail.ttlMs ? new Date(now.getTime() + mail.ttlMs).toISOString() : null,
      allowed ? null : 'not on the allow list',
      now.toISOString(),
    )
    .run()
  if (allowed) await nudge(env, 'mail')
  return id
}

interface OutboxRow {
  id: string
  kind: MailKind
  to_address: string
  language: UiLanguage
  params: string
  attempts: number
  expires_at: string | null
}

const withoutLink = (params: string): string => {
  try {
    const { link: _link, ...rest } = JSON.parse(params) as Record<string, unknown>
    return JSON.stringify(rest)
  } catch {
    return '{}'
  }
}

/** Claim up to `limit` messages due now. */
async function claimMail(db: D1Database, limit: number): Promise<OutboxRow[]> {
  const now = nowIso()
  const { results } = await db
    .prepare(
      `UPDATE mail_outbox SET status = 'sending', attempts = attempts + 1, next_attempt_at = ?1
       WHERE id IN (SELECT id FROM mail_outbox WHERE status = 'queued' AND next_attempt_at <= ?1 ORDER BY next_attempt_at LIMIT ?2) AND status = 'queued'
       RETURNING id, kind, to_address, language, params, attempts, expires_at`,
    )
    .bind(now, limit)
    .all<OutboxRow>()
  return results
}

/** Send what's due, up to `limit`. Returns how many were taken. */
export async function sendDueMail(env: DamBindings, limit = MAIL_CLAIM): Promise<number> {
  const settings = await getMailSettings(env.DB)
  if (!mailReady(env, settings)) return 0
  const rows = await claimMail(env.DB, limit)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const stop = await sendRow(env, settings, row)
    if (stop) {
      // The account or sender is wrong: the rest go back unsent, as they were.
      const rest = rows.slice(i + 1).map((r) => r.id)
      if (rest.length) {
        await env.DB.prepare("UPDATE mail_outbox SET status = 'queued', attempts = attempts - 1 WHERE id IN (SELECT value FROM json_each(?)) AND status = 'sending'")
          .bind(JSON.stringify(rest))
          .run()
      }
      break
    }
  }
  return rows.length
}

/** Send one claimed message and record what happened. Returns true when sending must stop altogether. */
async function sendRow(env: DamBindings, settings: MailSettings, row: OutboxRow): Promise<boolean> {
  const db = env.DB
  const now = new Date()
  if (row.expires_at && Date.parse(row.expires_at) < now.getTime()) {
    await db.prepare("UPDATE mail_outbox SET status = 'dropped', error = 'expired', params = ? WHERE id = ?").bind(withoutLink(row.params), row.id).run()
    return false
  }
  let params: MailParams
  try {
    params = { ...(JSON.parse(row.params) as Omit<MailParams, 'studio'>), studio: settings.studio }
  } catch {
    params = { studio: settings.studio }
  }
  const rendered = renderMail(row.kind, row.language, params)
  const outcome = await sendMail(env, { to: row.to_address, ...rendered, fromName: settings.studio, ...(settings.replyTo ? { replyTo: settings.replyTo } : {}) })
  await recordOutcome(db, row, outcome, now)
  return !outcome.ok && outcome.then === 'stop'
}

async function recordOutcome(db: D1Database, row: Pick<OutboxRow, 'id' | 'params' | 'attempts'>, outcome: SendOutcome, now: Date): Promise<void> {
  const at = now.toISOString()
  if (outcome.ok) {
    await db.prepare("UPDATE mail_outbox SET status = 'sent', sent_at = ?, provider_id = ?, error = NULL, params = ? WHERE id = ?").bind(at, outcome.id, withoutLink(row.params), row.id).run()
    return
  }
  const error = `${outcome.code}: ${outcome.message}`.slice(0, 400)
  if (outcome.then === 'stop') {
    await db.batch([
      db.prepare("UPDATE mail_outbox SET status = 'queued', attempts = attempts - 1, error = ? WHERE id = ?").bind(error, row.id),
      db
        .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .bind(MAIL_STOPPED_KEY, JSON.stringify({ code: outcome.code, message: outcome.message, at }), at),
    ])
    return
  }
  const later = outcome.then === 'retry' ? RETRY_AFTER_MS[Math.min(row.attempts - 1, RETRY_AFTER_MS.length - 1)]! : outcome.then === 'tomorrow' ? 86_400_000 : 0
  if ((outcome.then === 'retry' && row.attempts < MAX_ATTEMPTS) || outcome.then === 'tomorrow') {
    await db.prepare("UPDATE mail_outbox SET status = 'queued', next_attempt_at = ?, error = ? WHERE id = ?").bind(new Date(now.getTime() + later).toISOString(), error, row.id).run()
    return
  }
  await db
    .prepare('UPDATE mail_outbox SET status = ?, error = ?, params = ? WHERE id = ?')
    .bind(outcome.then === 'suppressed' ? 'suppressed' : 'failed', error, withoutLink(row.params), row.id)
    .run()
}

/**
 * The sweep's part: put back messages cut short, forget old ones, and send what's due (through the queue when there
 * is one). A few queries; none of it when mail is off and nothing is waiting.
 */
export async function mailSweep(env: DamBindings): Promise<number> {
  const db = env.DB
  const now = Date.now()
  const [, , waiting] = await db.batch([
    db.prepare("UPDATE mail_outbox SET status = 'queued' WHERE status = 'sending' AND next_attempt_at < ?").bind(new Date(now - STUCK_MS).toISOString()),
    db.prepare('DELETE FROM mail_outbox WHERE created_at < ?').bind(new Date(now - KEEP_MS).toISOString()),
    db.prepare("SELECT COUNT(*) AS n FROM mail_outbox WHERE status = 'queued' AND next_attempt_at <= ?").bind(new Date(now).toISOString()),
  ])
  const due = (waiting!.results[0] as { n: number } | undefined)?.n ?? 0
  if (due === 0) return 0
  if (env.WORK) {
    await nudge(env, 'mail', due)
    return due
  }
  return sendDueMail(env)
}

/**
 * Setup → Email's test: sent at once, so the page can show what went wrong. Recorded in the outbox like any other
 * message. Works before email is turned on (that's what it's for); a test that gets through clears a stop.
 */
export async function sendTestMail(env: DamBindings, to: string, language: UiLanguage, origin: string): Promise<SendOutcome> {
  const db = env.DB
  const settings = await getMailSettings(db)
  if (!allowedRecipient(env, to)) return { ok: false, code: 'E_NOT_ALLOWED', message: 'Not on this install’s allow list (MAIL_ALLOW_TO).', then: 'give_up' }
  const rendered = renderMail('test', language, { studio: settings.studio, link: origin })
  const outcome = await sendMail(env, { to, ...rendered, fromName: settings.studio, ...(settings.replyTo ? { replyTo: settings.replyTo } : {}) })
  const at = nowIso()
  await db.batch([
    db
      .prepare(
        `INSERT INTO mail_outbox (id, kind, to_address, language, params, status, attempts, next_attempt_at, provider_id, error, created_at, sent_at)
         VALUES (?, 'test', ?, ?, '{}', ?, 1, ?, ?, ?, ?, ?)`,
      )
      .bind(randomId(), to, language, outcome.ok ? 'sent' : 'failed', at, outcome.ok ? outcome.id : null, outcome.ok ? null : `${outcome.code}: ${outcome.message}`.slice(0, 400), at, outcome.ok ? at : null),
    ...(outcome.ok ? [db.prepare('DELETE FROM settings WHERE key = ?').bind(MAIL_STOPPED_KEY)] : []),
  ])
  return outcome
}

/** What Setup → Email shows about sending. One query. */
export async function mailStatus(db: D1Database): Promise<{ lastSentAt: string | null; lastError: string | null; lastErrorAt: string | null; today: number; waiting: number }> {
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const row = await db
    .prepare(
      `SELECT (SELECT MAX(sent_at) FROM mail_outbox WHERE status = 'sent') AS last_sent,
              (SELECT error FROM mail_outbox WHERE error IS NOT NULL AND status IN ('failed', 'queued', 'suppressed') ORDER BY created_at DESC LIMIT 1) AS last_error,
              (SELECT created_at FROM mail_outbox WHERE error IS NOT NULL AND status IN ('failed', 'queued', 'suppressed') ORDER BY created_at DESC LIMIT 1) AS last_error_at,
              (SELECT COUNT(*) FROM mail_outbox WHERE status = 'sent' AND sent_at >= ?) AS today,
              (SELECT COUNT(*) FROM mail_outbox WHERE status IN ('queued', 'sending')) AS waiting`,
    )
    .bind(since)
    .first<{ last_sent: string | null; last_error: string | null; last_error_at: string | null; today: number; waiting: number }>()
  return { lastSentAt: row?.last_sent ?? null, lastError: row?.last_error ?? null, lastErrorAt: row?.last_error_at ?? null, today: row?.today ?? 0, waiting: row?.waiting ?? 0 }
}
