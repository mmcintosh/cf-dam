/**
 * Emails about client galleries (plans/PLAN-E-v2.md §4): "A gallery for you" when the photographer emails a gallery's
 * members, "Closing soon" three days before it closes, and "Finished choosing" to the photographer. Only to members
 * (signed-in clients, whose address is known), never to anonymous visitors.
 *
 * Every member email can be turned off for that gallery: a signed link (and List-Unsubscribe headers) that switches
 * them off on a POST, never on a GET, since mail scanners open links.
 */
import type { UiLanguage } from '@cf-dam/i18n'
import type { DamBindings } from '../env'
import { siteLanguage } from '../lib/language'
import { nowIso } from '../lib/time'
import { personLanguage } from './account-mail'
import { getMailSettings, mailReady, queueMail } from './outbox'
import { renderMail } from './templates'

/** At most one "Email the members" per gallery in this long. */
export const MEMBERS_EMAIL_EVERY_MS = 6 * 3_600_000
/** "Email the members" per person per day. */
export const MEMBERS_EMAILS_PER_DAY = 20
/** Reminders go when a gallery closes within this long. */
export const CLOSING_SOON_MS = 3 * 86_400_000
const FINISHED_EVERY_MS = 3_600_000

const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** The signature on a "turn off this gallery's emails" link: HMAC with a key of its own, derived from the auth secret. */
export async function emailsOffSignature(env: Pick<DamBindings, 'BETTER_AUTH_SECRET'>, shareId: string, userId: string): Promise<string> {
  const secret = new TextEncoder().encode(`cf-dam gallery emails off\u0000${env.BETTER_AUTH_SECRET ?? ''}`)
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${shareId}:${userId}`))).slice(0, 32)
}

export async function emailsOffValid(env: Pick<DamBindings, 'BETTER_AUTH_SECRET'>, shareId: string, userId: string, signature: string): Promise<boolean> {
  const expected = await emailsOffSignature(env, shareId, userId)
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

const offQuery = async (env: DamBindings, shareId: string, userId: string) =>
  `s=${encodeURIComponent(shareId)}&u=${encodeURIComponent(userId)}&k=${await emailsOffSignature(env, shareId, userId)}`

/** Turn a member's emails for a gallery off (or back on). True if they're a member. */
export async function setGalleryEmails(db: D1Database, shareId: string, userId: string, on: boolean): Promise<boolean> {
  const result = await db.prepare('UPDATE share_members SET emails_off_at = ? WHERE share_id = ? AND user_id = ?').bind(on ? null : nowIso(), shareId, userId).run()
  return result.meta.changes === 1
}

interface GalleryRow {
  id: string
  token: string
  title: string
  name: string
  message: string
  language: string | null
  expires_at: string | null
}

const galleryTitle = (g: Pick<GalleryRow, 'title' | 'name'>) => g.title || g.name

/** A member's language for a gallery: the gallery's own, else their client record's, else their setting. */
async function memberLanguage(db: D1Database, userId: string, gallery: Pick<GalleryRow, 'language'>): Promise<UiLanguage> {
  if (gallery.language) return gallery.language as UiLanguage
  const row = await db.prepare('SELECT c.language FROM client_people p JOIN clients c ON c.id = p.client_id WHERE p.user_id = ? AND c.language IS NOT NULL').bind(userId).first<{ language: string }>()
  return (row?.language as UiLanguage | undefined) ?? (await personLanguage(db, userId))
}

/** Members a gallery email may go to: joined, active, emails not turned off. */
const RECIPIENTS = `SELECT u.id, u.name, u.email FROM share_members m JOIN users u ON u.id = m.user_id
  WHERE m.share_id = ? AND m.emails_off_at IS NULL AND u.is_active = 1
    AND (EXISTS (SELECT 1 FROM account a WHERE a.user_id = u.id) OR EXISTS (SELECT 1 FROM passkey p WHERE p.user_id = u.id))`

async function galleryParams(env: DamBindings, origin: string, gallery: GalleryRow, userId: string, name: string) {
  return {
    link: `${origin}/s/${gallery.token}`,
    offLink: `${origin}/api/public/email-off?${await offQuery(env, gallery.id, userId)}`,
    name: name.split(/\s+/)[0] || name,
    gallery: galleryTitle(gallery),
    ...(gallery.message ? { message: gallery.message.slice(0, 2000) } : {}),
    ...(gallery.expires_at ? { until: gallery.expires_at } : {}),
  }
}

export type MembersEmailOutcome = { kind: 'sent'; count: number } | { kind: 'off' } | { kind: 'too_soon'; next: string } | { kind: 'cap' } | { kind: 'none' } | { kind: 'not_found' }

/** "Email the members": a gallery for you, to every member who has joined and not turned emails off. */
export async function emailMembers(env: DamBindings, shareId: string, actorId: string): Promise<MembersEmailOutcome> {
  const db = env.DB
  const settings = await getMailSettings(db)
  if (!mailReady(env, settings) || !settings.origin) return { kind: 'off' }
  const gallery = await db
    .prepare('SELECT id, token, title, name, message, language, expires_at, members_emailed_at FROM shares WHERE id = ? AND revoked_at IS NULL')
    .bind(shareId)
    .first<GalleryRow & { members_emailed_at: string | null }>()
  if (!gallery) return { kind: 'not_found' }
  if (gallery.members_emailed_at && Date.parse(gallery.members_emailed_at) > Date.now() - MEMBERS_EMAIL_EVERY_MS) {
    return { kind: 'too_soon', next: new Date(Date.parse(gallery.members_emailed_at) + MEMBERS_EMAIL_EVERY_MS).toISOString() }
  }
  const today = await db
    .prepare("SELECT COUNT(*) AS n FROM activity_log WHERE user_id = ? AND action = 'share.members_emailed' AND created_at > ?")
    .bind(actorId, new Date(Date.now() - 86_400_000).toISOString())
    .first<{ n: number }>()
  if ((today?.n ?? 0) >= MEMBERS_EMAILS_PER_DAY) return { kind: 'cap' }
  const { results: members } = await db.prepare(RECIPIENTS).bind(shareId).all<{ id: string; name: string; email: string }>()
  if (members.length === 0) return { kind: 'none' }
  await db.prepare('UPDATE shares SET members_emailed_at = ? WHERE id = ?').bind(nowIso(), shareId).run()
  let count = 0
  for (const m of members) {
    const id = await queueMail(env, {
      kind: 'galleryReady',
      to: m.email,
      userId: m.id,
      language: await memberLanguage(db, m.id, gallery),
      params: await galleryParams(env, settings.origin, gallery, m.id, m.name),
      createdBy: actorId,
    })
    if (id) count++
  }
  return { kind: 'sent', count }
}

/** What "Email the members" would send, for the photographer to look at first (in the gallery's language). */
export async function previewMembersEmail(env: DamBindings, shareId: string, origin: string) {
  const db = env.DB
  const gallery = await db.prepare('SELECT id, token, title, name, message, language, expires_at FROM shares WHERE id = ?').bind(shareId).first<GalleryRow>()
  if (!gallery) return null
  const settings = await getMailSettings(db)
  const lang = (gallery.language as UiLanguage | null) ?? (await siteLanguage(db)) ?? 'en'
  const { results } = await db.prepare(`${RECIPIENTS} LIMIT 1`).bind(shareId).all<{ id: string; name: string }>()
  const sample = results[0] ?? { id: 'preview', name: '…' }
  const params = { ...(await galleryParams(env, settings.origin ?? origin, gallery, sample.id, sample.name)), studio: settings.studio }
  const recipients = (await db.prepare(`SELECT COUNT(*) AS n FROM (${RECIPIENTS})`).bind(shareId).first<{ n: number }>())?.n ?? 0
  return { ...renderMail('galleryReady', lang, params), recipients }
}

/**
 * The sweep's part: members of galleries closing within three days who haven't pressed "I'm done", reminded once per
 * closing date. A few at a time. Returns how many were queued.
 */
export async function closingSoonSweep(env: DamBindings, limit = 5): Promise<number> {
  const db = env.DB
  const settings = await getMailSettings(db)
  if (!mailReady(env, settings) || !settings.origin) return 0
  const now = new Date()
  const { results } = await db
    .prepare(
      `SELECT s.id, s.token, s.title, s.name, s.message, s.language, s.expires_at, u.id AS user_id, u.name AS user_name, u.email
       FROM share_members m JOIN shares s ON s.id = m.share_id JOIN users u ON u.id = m.user_id
       WHERE s.revoked_at IS NULL AND s.expires_at > ?1 AND s.expires_at <= ?2
         AND (m.reminded_for IS NULL OR m.reminded_for != s.expires_at) AND m.emails_off_at IS NULL AND u.is_active = 1
         AND (EXISTS (SELECT 1 FROM account a WHERE a.user_id = u.id) OR EXISTS (SELECT 1 FROM passkey p WHERE p.user_id = u.id))
         AND NOT EXISTS (SELECT 1 FROM share_visitors v WHERE v.share_id = s.id AND v.user_id = u.id AND v.submitted_at IS NOT NULL)
       LIMIT ?3`,
    )
    .bind(now.toISOString(), new Date(now.getTime() + CLOSING_SOON_MS).toISOString(), limit)
    .all<GalleryRow & { user_id: string; user_name: string; email: string }>()
  for (const r of results) {
    // Marked first: a reminder is never sent twice for one closing date, even if queueing fails.
    await db.prepare('UPDATE share_members SET reminded_for = ? WHERE share_id = ? AND user_id = ?').bind(r.expires_at, r.id, r.user_id).run()
    await queueMail(env, {
      kind: 'closingSoon',
      to: r.email,
      userId: r.user_id,
      language: await memberLanguage(db, r.user_id, r),
      params: await galleryParams(env, settings.origin, r, r.user_id, r.user_name),
      ttlMs: Math.max(0, Date.parse(r.expires_at!) - now.getTime()),
    })
  }
  return results.length
}

/**
 * A member pressed "I'm done": tell the photographer who made the gallery (or, if they've gone, the administrators),
 * at most once an hour per gallery.
 */
export async function notifyFinished(env: DamBindings, shareId: string, who: string): Promise<void> {
  const db = env.DB
  const settings = await getMailSettings(db)
  if (!mailReady(env, settings) || !settings.origin) return
  const cutoff = new Date(Date.now() - FINISHED_EVERY_MS).toISOString()
  const claimed = await db
    .prepare('UPDATE shares SET done_mailed_at = ? WHERE id = ? AND (done_mailed_at IS NULL OR done_mailed_at < ?) RETURNING id, title, name, created_by')
    .bind(nowIso(), shareId, cutoff)
    .first<{ id: string; title: string; name: string; created_by: string | null }>()
  if (!claimed) return
  for (const person of await galleryOwners(db, claimed.created_by)) {
    await queueMail(env, {
      kind: 'finished',
      to: person.email,
      userId: person.id,
      language: await personLanguage(db, person.id),
      params: { link: `${settings.origin}/galleries/${claimed.id}`, gallery: galleryTitle(claimed), who: who.slice(0, 100) },
    })
  }
}

/** Who hears about a gallery: whoever made it, or, if they've gone, the administrators. */
async function galleryOwners(db: D1Database, createdBy: string | null): Promise<{ id: string; email: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.email FROM users u WHERE u.is_active = 1 AND (
         u.id = ?1 OR (NOT EXISTS (SELECT 1 FROM users c WHERE c.id = ?1 AND c.is_active = 1)
           AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = 'admin')))`,
    )
    .bind(createdBy)
    .all<{ id: string; email: string }>()
  return results
}

/**
 * The couple suggested names (catalog/name-suggestions.ts): tell the photographer how many, with a link to Names to
 * check. Never the names themselves. The caller limits it to once an hour per gallery.
 */
export async function notifyNames(env: DamBindings, shareId: string, count: number): Promise<void> {
  const db = env.DB
  const settings = await getMailSettings(db)
  if (!mailReady(env, settings) || !settings.origin) return
  const share = await db.prepare('SELECT id, title, name, created_by FROM shares WHERE id = ?').bind(shareId).first<{ id: string; title: string; name: string; created_by: string | null }>()
  if (!share) return
  for (const person of await galleryOwners(db, share.created_by)) {
    await queueMail(env, {
      kind: 'namesWaiting',
      to: person.email,
      userId: person.id,
      language: await personLanguage(db, person.id),
      params: { link: `${settings.origin}/galleries/${share.id}#names`, gallery: galleryTitle(share), count },
    })
  }
}
