/**
 * API keys for programmatic access: the NAS agent, scripts, integrations.
 *
 * Format: `cfdam_` + 40 base62 characters. The prefix makes leaked keys findable by secret
 * scanners. Only the SHA-256 is stored; the key itself is shown once, at creation.
 */
import { randomBase62, randomId, sha256Hex } from '../lib/crypto'
import { nowIso } from '../lib/time'

export const API_KEY_PREFIX = 'cfdam_'
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 6

export interface ApiKeyRecord {
  id: string
  userId: string
  name: string
  prefix: string
  scopes: string[]
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

interface ApiKeyRow {
  id: string
  user_id: string
  name: string
  prefix: string
  scopes: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

function parseScopes(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

function toRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    prefix: row.prefix,
    scopes: parseScopes(row.scopes),
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX) && value.length > DISPLAY_PREFIX_LENGTH
}

export async function createApiKey(
  db: D1Database,
  input: { userId: string; name: string; scopes: string[]; expiresAt: string | null },
): Promise<{ key: string; record: ApiKeyRecord }> {
  const key = API_KEY_PREFIX + randomBase62(40)
  const row: ApiKeyRow = {
    id: randomId(),
    user_id: input.userId,
    name: input.name,
    prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
    scopes: JSON.stringify(input.scopes),
    expires_at: input.expiresAt,
    last_used_at: null,
    revoked_at: null,
    created_at: nowIso(),
  }
  await db
    .prepare(
      `INSERT INTO api_keys (id, user_id, name, prefix, key_hash, scopes, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.user_id, row.name, row.prefix, await sha256Hex(key), row.scopes, row.expires_at, row.created_at)
    .run()
  return { key, record: toRecord(row) }
}

export async function listApiKeys(db: D1Database, userId: string): Promise<ApiKeyRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, name, prefix, scopes, expires_at, last_used_at, revoked_at, created_at
       FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<ApiKeyRow>()
  return results.map(toRecord)
}

/** Revoke one of the user's keys. Returns false if they have no such live key. */
export async function revokeApiKey(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db
    .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(nowIso(), id, userId)
    .run()
  return result.meta.changes > 0
}

/** The live key matching `key`, or null if it is unknown, revoked or expired. */
export async function findLiveApiKey(db: D1Database, key: string): Promise<ApiKeyRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, name, prefix, scopes, expires_at, last_used_at, revoked_at, created_at
       FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL`,
    )
    .bind(await sha256Hex(key))
    .first<ApiKeyRow>()
  if (!row) return null
  if (row.expires_at && row.expires_at <= nowIso()) return null
  return toRecord(row)
}

export function touchApiKey(db: D1Database, id: string): Promise<D1Result> {
  return db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(nowIso(), id).run()
}
