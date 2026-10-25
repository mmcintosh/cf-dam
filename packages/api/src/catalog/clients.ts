/**
 * Client accounts: people who sign in to see the client galleries they were invited to, and nothing
 * else. A client holds only the `client` role, which has no permissions, so every API that needs one
 * refuses them; the page middleware sends them to "Your galleries" from anywhere else.
 *
 * Access is per link (share): a client invited to a link gets that link's downloads, watermark and
 * expiry. Signed in, they skip its password, and their favourites are kept against their account
 * (a visitor row with their user id), so they follow them to any device.
 *
 * Invites are one-time links the photographer copies and sends themselves (cf-dam sends no email).
 * Only a hash of the token is kept, and a new invite for the same person replaces the old one.
 */
import { createAuth } from '../auth/auth'
import { hashPassword } from '../auth/password'
import { resolvePrincipal } from '../auth/principal'
import { setUserRoles } from '../auth/roles'
import type { DamBindings } from '../env'
import { randomBase62, randomId, sha256Hex } from '../lib/crypto'
import { BadRequest } from '../lib/http'
import { say } from '../lib/language'
import { nowIso } from '../lib/time'
import { shareStatus, type ShareRow, type VisitorRow } from './shares'

export const CLIENT_ROLE = 'client'
/** How long an invite link works. */
export const INVITE_DAYS = 14
/** A link that sets up a team account (an administrator's, perhaps) lives a few days, not two weeks. */
export const TEAM_INVITE_HOURS = 72
export type InviteKind = 'client' | 'team'
const INVITE_TOKEN = /^[0-9A-Za-z]{32}$/

/** Someone whose only role is Client. Anyone with another role as well is on the team. */
export const isClientOnly = (roles: readonly string[]) => roles.length > 0 && roles.every((r) => r === CLIENT_ROLE)

export interface MemberJson {
  userId: string
  name: string
  email: string
  /** False until they've used their invite and chosen a password. */
  joined: boolean
  isActive: boolean
  /** When their invite link stops working, while they haven't joined. */
  inviteExpiresAt: string | null
  lastLoginAt: string | null
  addedAt: string
  /** They turned this gallery's emails off. */
  emailsOff: boolean
  /** The last email to them bounced or failed: copy links for them instead. */
  mailProblem: 'suppressed' | 'failed' | null
}

export async function shareMembers(db: D1Database, shareId: string): Promise<MemberJson[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.is_active, u.last_login_at, m.created_at,
         EXISTS (SELECT 1 FROM account a WHERE a.user_id = u.id) OR EXISTS (SELECT 1 FROM passkey p WHERE p.user_id = u.id) AS joined,
         (SELECT i.expires_at FROM client_invites i WHERE i.user_id = u.id) AS invite_expires_at,
         m.emails_off_at,
         (SELECT o.status FROM mail_outbox o WHERE o.user_id = u.id AND o.status IN ('sent', 'failed', 'suppressed') ORDER BY o.created_at DESC LIMIT 1) AS mail_status
       FROM share_members m JOIN users u ON u.id = m.user_id
       WHERE m.share_id = ? ORDER BY m.created_at`,
    )
    .bind(shareId)
    .all<{ id: string; name: string; email: string; is_active: number; last_login_at: string | null; created_at: string; joined: number; invite_expires_at: string | null; emails_off_at: string | null; mail_status: string | null }>()
  return results.map((r) => ({
    userId: r.id,
    name: r.name,
    email: r.email,
    joined: r.joined === 1,
    isActive: r.is_active === 1,
    inviteExpiresAt: r.joined === 1 ? null : r.invite_expires_at,
    lastLoginAt: r.last_login_at,
    addedAt: r.created_at,
    emailsOff: r.emails_off_at !== null,
    mailProblem: r.mail_status === 'suppressed' || r.mail_status === 'failed' ? r.mail_status : null,
  }))
}

/**
 * A fresh one-time invite, replacing any earlier one (so only the newest link works). Returns the token (shown once).
 * A client's lasts two weeks; a team member's set-your-password link 72 hours.
 */
export async function newInvite(db: D1Database, userId: string, createdBy: string, kind: InviteKind = 'client'): Promise<{ token: string; expiresAt: string }> {
  const token = randomBase62(32)
  const now = nowIso()
  const expiresAt = new Date(Date.now() + (kind === 'team' ? TEAM_INVITE_HOURS * 3_600_000 : INVITE_DAYS * 86_400_000)).toISOString()
  await db
    .prepare(
      `INSERT INTO client_invites (user_id, token_hash, created_by, created_at, expires_at, kind) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, created_by = excluded.created_by, created_at = excluded.created_at, expires_at = excluded.expires_at, kind = excluded.kind`,
    )
    .bind(userId, await sha256Hex(token), createdBy, now, expiresAt, kind)
    .run()
  return { token, expiresAt }
}

/**
 * The client login for this email, made (with no password yet) if there's none. Null when the email belongs
 * to someone on the team: they can already see every album, so they aren't made a client.
 */
export async function clientAccount(env: DamBindings, request: Request, input: { name: string; email: string }): Promise<{ id: string } | null> {
  const db = env.DB
  const email = input.email.trim().toLowerCase()
  const user = await db
    .prepare(`SELECT u.id, (SELECT group_concat(r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles FROM users u WHERE lower(u.email) = ?`)
    .bind(email)
    .first<{ id: string; roles: string | null }>()
  if (user) return isClientOnly(user.roles ? user.roles.split(',') : []) ? { id: user.id } : null
  const auth = createAuth(env, request, { allowSignUp: true, role: CLIENT_ROLE })
  const ctx = await auth.$context
  // The internal adapter runs sign-up's hooks (which give the role) without signing anyone in.
  const created = await ctx.internalAdapter.createUser({ name: input.name, email, emailVerified: false }, { method: 'email-password' })
  await setUserRoles(db, created.id, [CLIENT_ROLE])
  return { id: created.id }
}

export type InviteOutcome =
  | { kind: 'added'; member: MemberJson; invite: { token: string; expiresAt: string } | null }
  | { kind: 'team'; message: string }

/**
 * Invite someone to a link. A new email becomes a client account (no password yet) with an invite;
 * an existing client is added to the link, with a new invite only if they never joined. Someone on
 * the team can already see every album, so they aren't made a member.
 */
export async function inviteClient(env: DamBindings, request: Request, share: Pick<ShareRow, 'id'>, input: { name: string; email: string }, actorId: string): Promise<InviteOutcome> {
  const db = env.DB
  const user = await clientAccount(env, request, input)
  if (!user) return { kind: 'team', message: say('err.teamMember') }
  await db.prepare('INSERT OR IGNORE INTO share_members (share_id, user_id, added_by, created_at) VALUES (?, ?, ?, ?)').bind(share.id, user.id, actorId, nowIso()).run()
  const member = (await shareMembers(db, share.id)).find((m) => m.userId === user.id)!
  return { kind: 'added', member, invite: member.joined ? null : await newInvite(db, user.id, actorId) }
}

export async function removeMember(db: D1Database, shareId: string, userId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM share_members WHERE share_id = ? AND user_id = ?').bind(shareId, userId).run()
  return result.meta.changes === 1
}

/** Who an invite is for, while it still works. */
export async function readInvite(db: D1Database, token: string): Promise<{ userId: string; name: string; email: string; kind: InviteKind } | null> {
  if (!INVITE_TOKEN.test(token)) return null
  return db
    .prepare(
      `SELECT u.id AS userId, u.name, u.email, i.kind FROM client_invites i JOIN users u ON u.id = i.user_id
       WHERE i.token_hash = ? AND i.expires_at > ? AND u.is_active = 1`,
    )
    .bind(await sha256Hex(token), nowIso())
    .first<{ userId: string; name: string; email: string; kind: InviteKind }>()
}

/** Use an invite: set the client's password and spend the link. Returns their email, to sign in with. */
export async function acceptInvite(db: D1Database, token: string, password: string): Promise<{ userId: string; email: string } | null> {
  if (password.length < 12) throw new BadRequest(say('invite.api.short'))
  if (password.length > 256) throw new BadRequest(say('invite.api.long'))
  const invite = await readInvite(db, token)
  if (!invite) return null
  // Spent first, by its hash, so two tabs racing on one link can't both set a password.
  const spent = await db.prepare('DELETE FROM client_invites WHERE user_id = ? AND token_hash = ?').bind(invite.userId, await sha256Hex(token)).run()
  if (spent.meta.changes !== 1) return null
  const now = nowIso()
  await db.batch([
    db.prepare("DELETE FROM account WHERE user_id = ? AND provider_id = 'credential'").bind(invite.userId),
    db
      .prepare("INSERT INTO account (id, user_id, account_id, provider_id, password, created_at, updated_at) VALUES (?, ?, ?, 'credential', ?, ?, ?)")
      .bind(randomId(), invite.userId, invite.userId, await hashPassword(password), now, now),
    db.prepare('UPDATE users SET must_change_password = 0, failed_sign_ins = 0, locked_until = NULL, updated_at = ? WHERE id = ?').bind(now, invite.userId),
  ])
  return { userId: invite.userId, email: invite.email }
}

export interface ClientGalleryJson {
  token: string
  title: string
  message: string
  expiresAt: string | null
  expired: boolean
  photos: number
  coverId: string | null
  /** They turned this gallery's emails off. */
  emailsOff: boolean
}

/** The galleries a client was invited to that still exist: open ones first, then expired ones. */
export async function clientGalleries(db: D1Database, userId: string): Promise<ClientGalleryJson[]> {
  const { results } = await db
    .prepare(
      `SELECT s.token, s.title, s.message, s.expires_at, s.revoked_at, m.emails_off_at,
         (SELECT COUNT(*) FROM album_items ai JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL WHERE ai.album_id = s.album_id) AS photos,
         COALESCE(al.cover_asset_id, (SELECT ai.asset_id FROM album_items ai JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL
                                      WHERE ai.album_id = s.album_id ORDER BY ai.position, ai.added_at LIMIT 1)) AS cover
       FROM share_members m JOIN shares s ON s.id = m.share_id JOIN albums al ON al.id = s.album_id
       WHERE m.user_id = ? AND s.revoked_at IS NULL ORDER BY s.created_at DESC`,
    )
    .bind(userId)
    .all<{ token: string; title: string; message: string; expires_at: string | null; revoked_at: string | null; emails_off_at: string | null; photos: number; cover: string | null }>()
  return results
    .map((r) => ({
      token: r.token,
      title: r.title,
      message: r.message,
      expiresAt: r.expires_at,
      expired: shareStatus(r) === 'expired',
      photos: r.photos,
      coverId: r.cover,
      emailsOff: r.emails_off_at !== null,
    }))
    .sort((a, b) => Number(a.expired) - Number(b.expired))
}

/**
 * The signed-in client this request comes from, if they're a member of this link. Requests without
 * cf-dam's session cookie (most gallery visitors) don't cost a session lookup.
 */
export async function galleryMember(env: DamBindings, share: Pick<ShareRow, 'id'>, request: Request): Promise<{ userId: string; name: string; email: string } | null> {
  if (!(request.headers.get('Cookie') ?? '').includes('cfdam.session_token')) return null
  const principal = await resolvePrincipal(env, request)
  if (!principal || principal.setup || principal.via !== 'session') return null
  const member = await env.DB.prepare('SELECT 1 FROM share_members WHERE share_id = ? AND user_id = ?').bind(share.id, principal.userId).first()
  return member ? { userId: principal.userId, name: principal.name, email: principal.email } : null
}

/** A member's own visitor row on a link, made the first time they open it. */
export async function memberVisitor(db: D1Database, share: Pick<ShareRow, 'id'>, member: { userId: string; name: string; email: string }): Promise<VisitorRow> {
  const now = nowIso()
  await db
    .prepare('INSERT OR IGNORE INTO share_visitors (id, share_id, name, email, created_at, last_seen_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(randomId(), share.id, member.name, member.email, now, now, member.userId)
    .run()
  return (await db.prepare('SELECT * FROM share_visitors WHERE share_id = ? AND user_id = ?').bind(share.id, member.userId).first<VisitorRow>())!
}
