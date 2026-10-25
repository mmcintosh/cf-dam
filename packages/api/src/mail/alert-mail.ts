/**
 * "Needs attention" (plans/PLAN-E-v2.md §4): when an alert opens, the people who see alerts and keep the email on get
 * one, at most once a day for each kind of problem. Sent from the email stage of the sweep, looking at alerts opened
 * since it last looked, so the alert check itself stays as it was. Email's own alerts are never emailed, and a
 * desktop helper going offline (a laptop asleep) isn't either.
 */
import type { UiLanguage } from '@cf-dam/i18n'
import type { DamBindings } from '../env'
import { parsePreferences } from '../catalog/preferences'
import { siteLanguage } from '../lib/language'
import { nowIso } from '../lib/time'
import { getMailSettings, mailReady, queueMail } from './outbox'

const CHECKED_KEY = 'mail.alerts.checked'
const DAY_MS = 86_400_000

interface OpenedRow {
  kind: string
  text: string | null
  message: string
}

/** Queue "needs attention" emails for alerts opened since the last look. Returns how many were queued. */
export async function alertEmailSweep(env: DamBindings): Promise<number> {
  const db = env.DB
  const settings = await getMailSettings(db)
  if (!mailReady(env, settings) || !settings.origin) return 0
  const now = nowIso()
  const checked = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(CHECKED_KEY).first<{ value: string }>()
  const mark = db
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(CHECKED_KEY, now, now)
  // The first look only starts the clock: alerts already open when email was turned on aren't news.
  if (!checked) {
    await mark.run()
    return 0
  }
  const [opened] = await db.batch([
    db.prepare("SELECT kind, text, message FROM alerts WHERE opened_at > ? AND opened_at <= ? AND resolved_at IS NULL AND kind NOT LIKE 'mail.%' ORDER BY opened_at").bind(checked.value, now),
    mark,
  ])
  const fresh = (opened!.results as unknown as OpenedRow[]).filter((a) => !(a.kind === 'agent.offline' && (a.text ?? '').includes('alert.offlineDesktop')))
  if (fresh.length === 0) return 0

  const { results: people } = await db
    .prepare(
      `SELECT DISTINCT u.id, u.email, p.value AS preferences FROM users u
         JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.permission_id = 'alerts:read'
         LEFT JOIN user_preferences p ON p.user_id = u.id
       WHERE u.is_active = 1`,
    )
    .all<{ id: string; email: string; preferences: string | null }>()
  const archive = (await siteLanguage(db)) ?? 'en'
  let queued = 0
  for (const person of people) {
    let prefs
    try {
      prefs = parsePreferences(person.preferences ? JSON.parse(person.preferences) : {})
    } catch {
      prefs = parsePreferences({})
    }
    if (!prefs.alertEmails) continue
    // One email per kind of problem per day: kinds already sent today are left out.
    const { results: sent } = await db
      .prepare("SELECT params FROM mail_outbox WHERE kind = 'alert' AND user_id = ? AND created_at > ?")
      .bind(person.id, new Date(Date.now() - DAY_MS).toISOString())
      .all<{ params: string }>()
    const already = new Set(sent.flatMap((r) => (JSON.parse(r.params) as { kinds?: string }).kinds?.split(',') ?? []))
    const news = fresh.filter((a) => !already.has(a.kind))
    if (news.length === 0) continue
    const id = await queueMail(env, {
      kind: 'alert',
      to: person.email,
      userId: person.id,
      language: (prefs.language === 'auto' ? archive : prefs.language) as UiLanguage,
      params: {
        link: `${settings.origin}/admin/alerts`,
        kinds: [...new Set(news.map((a) => a.kind))].join(','),
        texts: JSON.stringify(news.slice(0, 10).map((a) => (a.text ? JSON.parse(a.text) : { message: a.message }))),
      },
    })
    if (id) queued++
  }
  return queued
}
