/**
 * Emails about a person's own account (plans/PLAN-E-v2.md §4): the password reset link, and the notice that the
 * password was changed. Called from Better Auth's hooks (auth/auth.ts).
 */
import type { UiLanguage } from '@cf-dam/i18n'
import { getPreferences } from '../catalog/preferences'
import type { DamBindings } from '../env'
import { logActivity } from '../lib/activity'
import { siteLanguage } from '../lib/language'
import { getMailSettings, queueMail } from './outbox'

/** A reset link lives as long as Better Auth's token. */
export const RESET_TTL_SECONDS = 60 * 60

/** The language a person reads their email in: their own choice, else the archive's. */
export async function personLanguage(db: D1Database, userId: string): Promise<UiLanguage> {
  const { language } = await getPreferences(db, userId)
  return (language === 'auto' ? null : language) ?? (await siteLanguage(db)) ?? 'en'
}

/**
 * Better Auth's `sendResetPassword`: queue the link (built from the address email was turned on at, never from the
 * request). Nothing for a deactivated account, or when email is off. Returns at once; the email goes from the queue.
 */
export async function queueResetEmail(env: DamBindings, user: { id: string; email: string }, token: string): Promise<void> {
  const row = await env.DB.prepare('SELECT is_active FROM users WHERE id = ?').bind(user.id).first<{ is_active: number }>()
  if (!row || row.is_active !== 1) return
  const { origin } = await getMailSettings(env.DB)
  if (!origin) return
  await queueMail(env, {
    kind: 'reset',
    to: user.email,
    userId: user.id,
    language: await personLanguage(env.DB, user.id),
    params: { link: `${origin}/reset-password?token=${encodeURIComponent(token)}` },
    ttlMs: RESET_TTL_SECONDS * 1000,
  })
}

/**
 * Better Auth's `onPasswordReset` (sessions are already ended): the new password replaces any temporary one and any
 * lockout, an old invite link can no longer set a password, it's in Activity, and the person is told.
 */
export async function afterPasswordReset(env: DamBindings, user: { id: string; email: string }, ip: string | undefined): Promise<void> {
  const db = env.DB
  await db.batch([
    db.prepare('UPDATE users SET must_change_password = 0, failed_sign_ins = 0, locked_until = NULL WHERE id = ?').bind(user.id),
    db.prepare('DELETE FROM client_invites WHERE user_id = ?').bind(user.id),
  ])
  await logActivity(db, { userId: user.id, action: 'account.password_reset', targetType: 'user', targetId: user.id, ipAddress: ip })
  await queueMail(env, { kind: 'passwordChanged', to: user.email, userId: user.id, language: await personLanguage(db, user.id), params: {} })
}
