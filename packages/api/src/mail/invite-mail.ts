/**
 * Invitations by email (plans/PLAN-E-v2.md §4): a client invited to a gallery or added to a client record, and a new
 * team member choosing their password. The link is the one shown on the page (only the newest works), sent in the
 * client's language. A sender may queue a hundred invitations a day.
 */
import type { UiLanguage } from '@cf-dam/i18n'
import type { DamBindings } from '../env'
import { siteLanguage } from '../lib/language'
import type { InviteKind } from '../catalog/clients'
import { personLanguage } from './account-mail'
import { getMailSettings, mailReady, queueMail } from './outbox'

export const INVITES_PER_DAY = 100

/** Whether invitations can go by email now (for the forms' "Email it to them"). */
export async function mailOn(env: DamBindings): Promise<boolean> {
  return mailReady(env, await getMailSettings(env.DB))
}

/** A client's language: their client record's, else the gallery's, else their own setting, else the archive's. */
async function clientLanguage(env: DamBindings, userId: string, galleryLanguage: string | null | undefined): Promise<UiLanguage> {
  const row = await env.DB.prepare('SELECT c.language FROM client_people p JOIN clients c ON c.id = p.client_id WHERE p.user_id = ? AND c.language IS NOT NULL').bind(userId).first<{ language: string }>()
  return ((row?.language ?? galleryLanguage) as UiLanguage | null) ?? (await personLanguage(env.DB, userId)) ?? (await siteLanguage(env.DB)) ?? 'en'
}

export interface InviteEmail {
  kind: InviteKind
  userId: string
  name: string
  email: string
  token: string
  expiresAt: string
  /** Who's sending it: their name goes in a team invite, and it counts toward their daily cap. */
  by: { userId: string; name: string }
  /** For a client invited to a gallery: its title and fixed language. */
  gallery?: { title: string; language: string | null }
}

/** Queue the invitation. False when email is off or the sender has reached today's cap (the link is still shown). */
export async function emailInvite(env: DamBindings, invite: InviteEmail): Promise<boolean> {
  const settings = await getMailSettings(env.DB)
  if (!mailReady(env, settings) || !settings.origin) return false
  const sent = await env.DB.prepare("SELECT COUNT(*) AS n FROM mail_outbox WHERE created_by = ? AND kind IN ('invite', 'teamInvite') AND created_at > ?")
    .bind(invite.by.userId, new Date(Date.now() - 86_400_000).toISOString())
    .first<{ n: number }>()
  if ((sent?.n ?? 0) >= INVITES_PER_DAY) return false
  const id = await queueMail(env, {
    kind: invite.kind === 'team' ? 'teamInvite' : 'invite',
    to: invite.email,
    userId: invite.userId,
    language: invite.kind === 'team' ? await personLanguage(env.DB, invite.userId) : await clientLanguage(env, invite.userId, invite.gallery?.language),
    params: {
      link: `${settings.origin}/invite/${invite.token}`,
      name: invite.name.split(/\s+/)[0] || invite.name,
      until: invite.expiresAt,
      ...(invite.kind === 'team' ? { by: invite.by.name } : {}),
      ...(invite.gallery?.title ? { gallery: invite.gallery.title } : {}),
    },
    ttlMs: Math.max(0, Date.parse(invite.expiresAt) - Date.now()),
    createdBy: invite.by.userId,
  })
  return id !== null
}
