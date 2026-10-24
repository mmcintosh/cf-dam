/**
 * Clients (plans/PLAN-C-v2.md, phase C2): a person, a couple, a family or a company, with contact details,
 * notes, and the client logins that belong to them (catalog/clients.ts makes those logins). Administrators
 * only (`clients:manage`): these are personal details.
 *
 * Being linked to a client grants nothing. Galleries are still shared per link, so an agency's art buyers
 * don't see each other's galleries; the client page just gathers what was shared with any of them.
 */
import { asLanguage, type Language } from '@cf-dam/i18n'
import type { DamBindings } from '../env'
import { randomId } from '../lib/crypto'
import { BadRequest, optionalString } from '../lib/http'
import { say } from '../lib/language'
import { nowIso } from '../lib/time'
import { clientAccount, isClientOnly, newInvite } from './clients'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Lower case without accents, so "muller" finds "Müller" (D1's LIKE folds ASCII only). */
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

interface ClientRow {
  id: string
  name: string
  company: string
  email: string
  phone: string
  address: string
  language: string | null
  notes: string
  past_at: string | null
  created_at: string
  updated_at: string
}

export interface ClientSummary {
  id: string
  name: string
  company: string
  email: string
  phone: string
  /** Logins linked to them. */
  people: number
  /** Galleries shared with their people, or of their jobs, that are still open. */
  openGalleries: number
  /** When one of their people last opened or downloaded from a gallery. */
  lastSeenAt: string | null
  pastAt: string | null
}

export interface ClientJson extends ClientSummary {
  address: string
  language: Language | null
  notes: string
  createdAt: string
  updatedAt: string
}

export interface ClientInput {
  name?: string
  company?: string
  email?: string
  phone?: string
  address?: string
  notes?: string
  /** null: no preference. */
  language?: Language | null
}

/** Read and check a create or edit request. */
export function parseClientInput(body: Record<string, unknown>, creating: boolean): ClientInput {
  const name = optionalString(body, 'name', 200)
  if (creating && !name) throw new BadRequest(say('err.clientName'))
  if (name !== undefined && !name) throw new BadRequest(say('err.clientName'))
  const email = optionalString(body, 'email', 254)?.toLowerCase()
  if (email && !EMAIL.test(email)) throw new BadRequest(say('err.clientEmail'))
  const input: ClientInput = {
    name,
    company: optionalString(body, 'company', 200),
    email,
    phone: optionalString(body, 'phone', 60),
    address: optionalString(body, 'address', 1000),
    notes: optionalString(body, 'notes', 10_000),
  }
  if (body.language === null || body.language === '') input.language = null
  else if (body.language !== undefined) {
    const language = asLanguage(body.language) as Language | null
    if (!language) throw new BadRequest('language must be one of the archive languages, or null.')
    input.language = language
  }
  return input
}

const SUMMARY = `SELECT c.*,
  (SELECT COUNT(*) FROM client_people p WHERE p.client_id = c.id) AS people,
  (SELECT COUNT(*) FROM shares s WHERE s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?1)
     AND (s.id IN (SELECT m.share_id FROM client_people p JOIN share_members m ON m.user_id = p.user_id WHERE p.client_id = c.id)
          OR s.album_id IN (SELECT al.id FROM albums al JOIN jobs j ON j.id = al.job_id WHERE j.client_id = c.id))) AS open_galleries,
  (SELECT MAX(e.created_at) FROM client_people p JOIN share_visitors v ON v.user_id = p.user_id JOIN share_events e ON e.visitor_id = v.id
     WHERE p.client_id = c.id) AS last_seen_at
  FROM clients c`

type SummaryRow = ClientRow & { people: number; open_galleries: number; last_seen_at: string | null }

const summaryJson = (r: SummaryRow): ClientSummary => ({
  id: r.id,
  name: r.name,
  company: r.company,
  email: r.email,
  phone: r.phone,
  people: r.people,
  openGalleries: r.open_galleries,
  lastSeenAt: r.last_seen_at,
  pastAt: r.past_at,
})

/** Clients A–Z. Every word of `q` must appear in their details or their people's names and emails. */
export async function listClients(db: D1Database, options: { q?: string; past?: boolean } = {}): Promise<ClientSummary[]> {
  const words = fold(options.q ?? '').split(/\s+/).filter(Boolean).slice(0, 8)
  const where = [options.past ? 'c.past_at IS NOT NULL' : 'c.past_at IS NULL', ...words.map((_, i) => `c.search LIKE ?${i + 2} ESCAPE '\\'`)]
  const { results } = await db
    .prepare(`${SUMMARY} WHERE ${where.join(' AND ')} ORDER BY c.name COLLATE NOCASE LIMIT 500`)
    .bind(nowIso(), ...words.map((w) => `%${w.replace(/[\\%_]/g, (m) => `\\${m}`)}%`))
    .all<SummaryRow>()
  return results.map(summaryJson)
}

/** How many past clients there are, for the "Past clients" link. */
export async function countPastClients(db: D1Database): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM clients WHERE past_at IS NOT NULL').first<{ n: number }>())!.n
}

export async function getClient(db: D1Database, id: string): Promise<ClientJson | null> {
  const row = await db.prepare(`${SUMMARY} WHERE c.id = ?2`).bind(nowIso(), id).first<SummaryRow>()
  if (!row) return null
  return {
    ...summaryJson(row),
    address: row.address,
    language: (asLanguage(row.language) as Language | null) ?? null,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Fold the client's details and their people's names and emails into the search column. */
export async function refreshSearch(db: D1Database, clientId: string): Promise<void> {
  const client = await db.prepare('SELECT name, company, email, phone FROM clients WHERE id = ?').bind(clientId).first<Pick<ClientRow, 'name' | 'company' | 'email' | 'phone'>>()
  if (!client) return
  const { results: people } = await db
    .prepare('SELECT u.name, u.email FROM client_people p JOIN users u ON u.id = p.user_id WHERE p.client_id = ?')
    .bind(clientId)
    .all<{ name: string; email: string }>()
  const text = [client.name, client.company, client.email, client.phone, ...people.flatMap((p) => [p.name, p.email])].filter(Boolean).join(' ')
  await db.prepare('UPDATE clients SET search = ? WHERE id = ?').bind(fold(text), clientId).run()
}

export async function createClient(db: D1Database, input: ClientInput, actorId: string): Promise<string> {
  const id = randomId()
  const now = nowIso()
  await db
    .prepare(
      `INSERT INTO clients (id, name, company, email, phone, address, language, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.name!, input.company ?? '', input.email ?? '', input.phone ?? '', input.address ?? '', input.language ?? null, input.notes ?? '', actorId, now, now)
    .run()
  await refreshSearch(db, id)
  return id
}

const COLUMNS: Record<keyof ClientInput, string> = { name: 'name', company: 'company', email: 'email', phone: 'phone', address: 'address', notes: 'notes', language: 'language' }

/** Change the given fields. Returns the names of the fields that were sent, or null if there's no such client. */
export async function updateClient(db: D1Database, id: string, input: ClientInput): Promise<string[] | null> {
  const fields = (Object.keys(COLUMNS) as (keyof ClientInput)[]).filter((k) => input[k] !== undefined)
  const result = await db
    .prepare(`UPDATE clients SET ${[...fields.map((f) => `${COLUMNS[f]} = ?`), 'updated_at = ?'].join(', ')} WHERE id = ?`)
    .bind(...fields.map((f) => input[f] ?? null), nowIso(), id)
    .run()
  if (result.meta.changes !== 1) return null
  await refreshSearch(db, id)
  return fields
}

/** Mark as a past client (hidden from the list by default), or as current again. */
export async function setPast(db: D1Database, id: string, past: boolean): Promise<boolean> {
  const now = nowIso()
  const result = await db.prepare('UPDATE clients SET past_at = ?, updated_at = ? WHERE id = ?').bind(past ? now : null, now, id).run()
  return result.meta.changes === 1
}

export interface ClientPersonJson {
  userId: string
  name: string
  email: string
  /** False until they've used their invite and chosen a password. */
  joined: boolean
  isActive: boolean
  inviteExpiresAt: string | null
  lastLoginAt: string | null
  /** Links they were invited to. */
  galleries: number
}

export async function clientPeople(db: D1Database, clientId: string): Promise<ClientPersonJson[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.is_active, u.last_login_at,
         EXISTS (SELECT 1 FROM account a WHERE a.user_id = u.id) OR EXISTS (SELECT 1 FROM passkey k WHERE k.user_id = u.id) AS joined,
         (SELECT i.expires_at FROM client_invites i WHERE i.user_id = u.id) AS invite_expires_at,
         (SELECT COUNT(*) FROM share_members m WHERE m.user_id = u.id) AS galleries
       FROM client_people p JOIN users u ON u.id = p.user_id
       WHERE p.client_id = ? ORDER BY u.name COLLATE NOCASE`,
    )
    .bind(clientId)
    .all<{ id: string; name: string; email: string; is_active: number; last_login_at: string | null; joined: number; invite_expires_at: string | null; galleries: number }>()
  return results.map((r) => ({
    userId: r.id,
    name: r.name,
    email: r.email,
    joined: r.joined === 1,
    isActive: r.is_active === 1,
    inviteExpiresAt: r.joined === 1 ? null : r.invite_expires_at,
    lastLoginAt: r.last_login_at,
    galleries: r.galleries,
  }))
}

/**
 * Client logins not linked to any client, to offer on a client's page. Those sharing the client's email, then
 * its domain (not for webmail), come first.
 */
export async function unlinkedLogins(db: D1Database, clientId: string): Promise<{ userId: string; name: string; email: string; suggested: boolean }[]> {
  const client = await db.prepare('SELECT email FROM clients WHERE id = ?').bind(clientId).first<{ email: string }>()
  const { results } = await db
    .prepare(
      `SELECT u.id, u.name, u.email, (SELECT group_concat(r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles
       FROM users u WHERE NOT EXISTS (SELECT 1 FROM client_people p WHERE p.user_id = u.id)
       ORDER BY u.name COLLATE NOCASE LIMIT 1000`,
    )
    .all<{ id: string; name: string; email: string; roles: string | null }>()
  const email = (client?.email ?? '').toLowerCase()
  const domain = email.split('@')[1] ?? ''
  const webmail = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|aol|proton|protonmail|gmx|web|mail)\./.test(domain)
  const score = (e: string) => (email && e.toLowerCase() === email ? 2 : domain && !webmail && e.toLowerCase().endsWith(`@${domain}`) ? 1 : 0)
  return results
    .filter((r) => isClientOnly(r.roles ? r.roles.split(',') : []))
    .map((r) => ({ userId: r.id, name: r.name, email: r.email, suggested: score(r.email) > 0, score: score(r.email) }))
    .sort((a, b) => b.score - a.score)
    .map(({ score: _, ...r }) => r)
}

export type LinkOutcome = { kind: 'linked' } | { kind: 'not_found' } | { kind: 'team' } | { kind: 'elsewhere'; clientName: string }

/** Link a client login to this client. A login belongs to one client at most; team members can't be linked. */
export async function linkPerson(db: D1Database, clientId: string, userId: string, actorId: string): Promise<LinkOutcome> {
  const user = await db
    .prepare(`SELECT u.id, (SELECT group_concat(r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles FROM users u WHERE u.id = ?`)
    .bind(userId)
    .first<{ id: string; roles: string | null }>()
  if (!user || !(await db.prepare('SELECT 1 FROM clients WHERE id = ?').bind(clientId).first())) return { kind: 'not_found' }
  if (!isClientOnly(user.roles ? user.roles.split(',') : [])) return { kind: 'team' }
  const other = await db.prepare('SELECT c.id, c.name FROM client_people p JOIN clients c ON c.id = p.client_id WHERE p.user_id = ?').bind(userId).first<{ id: string; name: string }>()
  if (other && other.id !== clientId) return { kind: 'elsewhere', clientName: other.name }
  await db.prepare('INSERT OR IGNORE INTO client_people (user_id, client_id, linked_by, created_at) VALUES (?, ?, ?, ?)').bind(userId, clientId, actorId, nowIso()).run()
  await refreshSearch(db, clientId)
  return { kind: 'linked' }
}

/** Unlink a login from the client. The login stays, with its galleries. */
export async function unlinkPerson(db: D1Database, clientId: string, userId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM client_people WHERE client_id = ? AND user_id = ?').bind(clientId, userId).run()
  if (result.meta.changes !== 1) return false
  await refreshSearch(db, clientId)
  return true
}

export type AddPersonOutcome =
  | { kind: 'added'; userId: string; invite: { token: string; expiresAt: string } | null }
  | { kind: 'team' }
  | { kind: 'elsewhere'; clientName: string }

/**
 * Add someone to the client by name and email: their login is found or made (with no password yet) and linked,
 * with a one-time invite link if they haven't chosen a password.
 */
export async function addPerson(env: DamBindings, request: Request, clientId: string, input: { name: string; email: string }, actorId: string): Promise<AddPersonOutcome | null> {
  const db = env.DB
  if (!(await db.prepare('SELECT 1 FROM clients WHERE id = ?').bind(clientId).first())) return null
  const account = await clientAccount(env, request, input)
  if (!account) return { kind: 'team' }
  const linked = await linkPerson(db, clientId, account.id, actorId)
  if (linked.kind === 'elsewhere') return linked
  if (linked.kind !== 'linked') return { kind: 'team' }
  const person = (await clientPeople(db, clientId)).find((p) => p.userId === account.id)!
  return { kind: 'added', userId: account.id, invite: person.joined ? null : await newInvite(db, account.id, actorId) }
}

export interface ClientDownloadJson {
  at: string
  shareId: string
  shareName: string
  assetId: string | null
  filename: string | null
  size: string | null
  person: string
}

/** What their people downloaded from galleries, newest first. */
export async function clientDownloads(db: D1Database, clientId: string, limit = 100): Promise<ClientDownloadJson[]> {
  const { results } = await db
    .prepare(
      `SELECT e.created_at, e.share_id, s.name AS share_name, e.asset_id, a.filename, e.size, v.name AS person
       FROM client_people p JOIN share_visitors v ON v.user_id = p.user_id JOIN share_events e ON e.visitor_id = v.id AND e.kind = 'download'
       JOIN shares s ON s.id = e.share_id LEFT JOIN assets a ON a.id = e.asset_id
       WHERE p.client_id = ? ORDER BY e.created_at DESC LIMIT ?`,
    )
    .bind(clientId, limit)
    .all<{ created_at: string; share_id: string; share_name: string; asset_id: string | null; filename: string | null; size: string | null; person: string }>()
  return results.map((r) => ({ at: r.created_at, shareId: r.share_id, shareName: r.share_name, assetId: r.asset_id, filename: r.filename, size: r.size, person: r.person }))
}

/**
 * Erase a client: their record, their logins (with sessions, invites and gallery memberships), the names and
 * emails they gave as gallery visitors, their jobs, and their details in the activity log. Their galleries,
 * albums and photos stay. Returns how many logins were removed, or null if there's no such client.
 */
export async function eraseClient(db: D1Database, clientId: string): Promise<{ people: number } | null> {
  const client = await db.prepare('SELECT email FROM clients WHERE id = ?').bind(clientId).first<{ email: string }>()
  if (!client) return null
  const { results: people } = await db
    .prepare('SELECT u.id, lower(u.email) AS email FROM client_people p JOIN users u ON u.id = p.user_id WHERE p.client_id = ?')
    .bind(clientId)
    .all<{ id: string; email: string }>()
  const ids = JSON.stringify(people.map((p) => p.id))
  const emails = JSON.stringify([...new Set([client.email.toLowerCase(), ...people.map((p) => p.email)].filter(Boolean))])
  await db.batch([
    // Visitor rows keep their picks (the photographer's record of what was chosen) but lose who they were.
    db
      .prepare(
        `UPDATE share_visitors SET name = ?, email = NULL
         WHERE user_id IN (SELECT value FROM json_each(?)) OR lower(email) IN (SELECT value FROM json_each(?))`,
      )
      .bind(say('client.erasedVisitor'), ids, emails),
    db
      .prepare(
        `UPDATE activity_log SET details = NULL, ip_address = NULL
         WHERE (target_type = 'client' AND target_id = ?)
            OR (target_type = 'user' AND target_id IN (SELECT value FROM json_each(?)))
            OR user_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(clientId, ids, ids),
    // Their jobs' history, then the jobs (their albums and galleries stay, outside any job).
    db
      .prepare("UPDATE activity_log SET details = NULL, ip_address = NULL WHERE target_type = 'job' AND target_id IN (SELECT id FROM jobs WHERE client_id = ?)")
      .bind(clientId),
    db.prepare('DELETE FROM jobs WHERE client_id = ?').bind(clientId),
    // Sessions, passwords, passkeys, invites, gallery memberships and the client_people rows go with the users.
    db.prepare('DELETE FROM users WHERE id IN (SELECT value FROM json_each(?))').bind(ids),
    db.prepare('DELETE FROM clients WHERE id = ?').bind(clientId),
  ])
  return { people: people.length }
}
