/**
 * NAS agents: pairing, their folders, and what they send.
 *
 * An agent reads files where they are (a Synology shared folder, a Mac's external drive) and sends
 * metadata and two WebP renditions; the original never leaves. Each agent owns a storage connection
 * with provider 'nas', so its files are asset_locations rows (storage class 'NAS') keyed by the path
 * the agent sees.
 *
 * Recognising the same file: by path first; after a rename or move, by the agent's quick fingerprint
 * (SHA-256 of size + first and last MiB), either because the agent says where the file was
 * (`previousPath`) or because a file with that fingerprint went missing from the same agent.
 */
import { API_KEY_PREFIX } from '../auth/api-keys'
import type { DamBindings } from '../env'
import { randomBase62, randomId, sha256Hex } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { deriveKey, open, seal, storageSecret } from '../storage/secret-box'
import { normalizeAgentMetadata } from './metadata'
import { finishAssets, metadataLookups, metadataStatements } from './process'
import { archiveConfig } from './archive'
import { mimeTypeFor, safeFilename } from './uploads'

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 410 = 400,
  ) {
    super(message)
  }
}

export const PAIRING_TTL_SECONDS = 600
export const POLL_INTERVAL_SECONDS = 5
export const SCAN_INTERVAL_MINUTES = 15
export const MAX_BATCH = 100
/** Synology's own folders, Mac and Windows clutter, Lightroom's caches. Agents skip these by default. */
export const DEFAULT_EXCLUDES = ['@eaDir', '#recycle', '#snapshot', '.SynologyWorkingDirectory', '._*', '.DS_Store', 'Thumbs.db', 'desktop.ini', '*.lrdata', 'Lightroom Catalog Backups']

// ── Pairing ──────────────────────────────────────────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I

function userCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
  return `${chars.slice(0, 4)}-${chars.slice(4)}`
}

export const normalizeUserCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2')

const shortText = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null)

export async function startPairing(db: D1Database, input: { name: unknown; platform: unknown; version: unknown }) {
  const name = shortText(input.name, 80) ?? 'NAS agent'
  const deviceCode = randomBase62(40)
  const code = userCode()
  const expiresAt = new Date(Date.now() + PAIRING_TTL_SECONDS * 1000).toISOString()
  await db.batch([
    db.prepare('DELETE FROM pairing_requests WHERE expires_at < ?').bind(nowIso()),
    db
      .prepare('INSERT INTO pairing_requests (device_hash, user_code, name, platform, version, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(await sha256Hex(deviceCode), code, name, shortText(input.platform, 40), shortText(input.version, 40), expiresAt, nowIso()),
  ])
  return { deviceCode, userCode: code, expiresIn: PAIRING_TTL_SECONDS, interval: POLL_INTERVAL_SECONDS }
}

interface PairingRow {
  device_hash: string
  user_code: string
  name: string
  platform: string | null
  version: string | null
  source_id: string | null
  sealed_key: string | null
  claimed_at: string | null
  expires_at: string
}

/** What a person sees before approving: the name and platform the agent gave. */
export async function pendingPairing(db: D1Database, code: string): Promise<PairingRow | null> {
  const row = await db.prepare('SELECT * FROM pairing_requests WHERE user_code = ?').bind(normalizeUserCode(code)).first<PairingRow>()
  return row && row.expires_at > nowIso() && !row.source_id && !row.claimed_at ? row : null
}

/**
 * A person approves a code: the agent gets a source, its own 'nas' storage connection, and an API
 * key that can only sync. The key waits, sealed, for the agent's next poll.
 */
export async function approvePairing(env: DamBindings, code: string, input: { name?: string | null; userId: string }) {
  const db = env.DB
  const row = await pendingPairing(db, code)
  if (!row) throw new AgentError('That code is unknown or has expired. Restart the agent for a new one.', 404)
  const name = shortText(input.name, 80) ?? row.name
  const now = nowIso()
  const sourceId = randomId()
  const connectionId = `nas-${sourceId}`
  // Claimed first, so two people approving one code at once can't both make an agent. The claim also
  // gives the agent a fresh ten minutes to collect its key: a code approved just before it expired
  // was otherwise purged (by the next pairing to start) before the agent's next poll.
  const collectBy = new Date(Date.now() + PAIRING_TTL_SECONDS * 1000).toISOString()
  const claimed = await db
    .prepare('UPDATE pairing_requests SET claimed_at = ?, expires_at = ? WHERE device_hash = ? AND claimed_at IS NULL AND source_id IS NULL AND expires_at > ?')
    .bind(now, collectBy, row.device_hash, now)
    .run()
  if (claimed.meta.changes !== 1) throw new AgentError('That code has just been approved, or has expired.', 409)
  // The key is the source's own (only its hash is kept), not an API key of the approver's: the agent
  // outlives their account, and only disconnecting it revokes it.
  const key = API_KEY_PREFIX + randomBase62(40)
  const sealed = await seal(await deriveKey(storageSecret(env)), key)
  await db.batch([
    db
      .prepare(
        `INSERT INTO storage_connections (id, name, provider, auth_mode, storage_classes, default_class, is_default, created_by, created_at, updated_at)
         VALUES (?, ?, 'nas', 'agent', '["NAS"]', 'NAS', 0, ?, ?, ?)`,
      )
      .bind(connectionId, name, input.userId, now, now),
    db
      .prepare('INSERT INTO sources (id, name, connection_id, key_hash, platform, version, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(sourceId, name, connectionId, await sha256Hex(key), row.platform, row.version, input.userId, now),
    db.prepare('UPDATE pairing_requests SET source_id = ?, sealed_key = ? WHERE device_hash = ?').bind(sourceId, sealed, row.device_hash),
  ])
  return { id: sourceId, name }
}

/** The agent's poll: pending, or (exactly once) its API key. */
export async function pollPairing(env: DamBindings, deviceCode: string): Promise<{ status: 'pending' } | { status: 'approved'; apiKey: string; sourceId: string } | { status: 'expired' }> {
  const db = env.DB
  const hash = await sha256Hex(deviceCode)
  const row = await db.prepare('SELECT * FROM pairing_requests WHERE device_hash = ?').bind(hash).first<PairingRow>()
  if (!row) return { status: 'expired' }
  if (row.source_id && row.sealed_key) {
    // Hand the key over once, then forget it.
    const deleted = await db.prepare('DELETE FROM pairing_requests WHERE device_hash = ? AND sealed_key IS NOT NULL').bind(hash).run()
    if (deleted.meta.changes === 0) return { status: 'expired' }
    return { status: 'approved', apiKey: await open(await deriveKey(storageSecret(env)), row.sealed_key), sourceId: row.source_id }
  }
  if (row.expires_at <= nowIso()) return { status: 'expired' }
  return { status: 'pending' }
}

// ── Sources and their folders ────────────────────────────────────────────────

export interface SourceRow {
  id: string
  name: string
  connection_id: string
  api_key_id: string | null
  platform: string | null
  version: string | null
  last_seen_at: string | null
  status: string
  folders: string
  volumes: string
  paused: number
  rescan: number
  revoked_at: string | null
  created_at: string
  /** Archive settings, JSON (catalog/archive.ts). */
  archive: string
}

export interface RootRow {
  id: string
  source_id: string
  path: string
  label: string | null
  include_globs: string
  exclude_globs: string
  enabled: number
  first_scan_done_at: string | null
  last_scan_at: string | null
  volume_id: string | null
  volume_label: string | null
  volume_path: string | null
  offline_since: string | null
}

export interface Volume {
  id: string
  label: string | null
  path: string
  removable: boolean
}

const json = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export const rootJson = (r: RootRow) => ({
  id: r.id,
  path: r.path,
  label: r.label,
  include: json<string[]>(r.include_globs, []),
  exclude: json<string[]>(r.exclude_globs, []),
  enabled: r.enabled === 1,
  firstScanDone: r.first_scan_done_at !== null,
  lastScanAt: r.last_scan_at,
  volume: r.volume_id ? { id: r.volume_id, label: r.volume_label, path: r.volume_path } : null,
  offlineSince: r.offline_since,
})

export async function getSource(db: D1Database, id: string): Promise<SourceRow | null> {
  return db.prepare('SELECT * FROM sources WHERE id = ?').bind(id).first<SourceRow>()
}

export async function listRoots(db: D1Database, sourceId: string): Promise<RootRow[]> {
  const { results } = await db.prepare('SELECT * FROM source_roots WHERE source_id = ? ORDER BY path').bind(sourceId).all<RootRow>()
  return results
}

/**
 * Agent-side absolute paths, with forward slashes: '/photos/photo' (Linux, macOS), 'E:/Archive'
 * (a Windows drive) or '//nas/photo' (a Windows network share). No '..', no control characters.
 */
export function cleanAgentPath(path: unknown): string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024) throw new AgentError('A path is 1–1024 characters.')
  if (/[\u0000-\u001f]/.test(path) || path.includes('\\')) throw new AgentError('Paths use forward slashes and no control characters.')
  const drive = /^([A-Za-z]):(?:\/|$)/.exec(path)
  const unc = !drive && path.startsWith('//')
  const parts = (drive ? path.slice(2) : path).split('/').filter(Boolean)
  if (parts.some((p) => p === '..' || p === '.')) throw new AgentError('Paths may not contain . or .. segments.')
  if (drive) return `${drive[1]!.toUpperCase()}:/${parts.join('/')}`
  if (unc) {
    if (parts.length < 2) throw new AgentError('A network path needs a server and a share: //server/share.')
    return `//${parts.join('/')}`
  }
  return `/${parts.join('/')}`
}

/** A folder path as a key prefix: '/photos/photo/' ('E:/' is one already). */
export const prefixOf = (base: string) => (base.endsWith('/') ? base : `${base}/`)
/** The location key of a file in a folder. */
export const keyOf = (base: string, rel: string) => `${prefixOf(base)}${rel}`
/** Whether `path` is `base` or inside it. */
export const within = (path: string, base: string) => path === base || path.startsWith(prefixOf(base))

/** A file's path inside a root: 'sub/dir/IMG_1.CR3'. Relative, never escaping the root. */
export function cleanRelativePath(path: unknown): string {
  // Relative means relative: not empty, not '/srv/x' (which, given a leading '/', read as //srv/x, a
  // network path), not 'C:/x'.
  if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new AgentError('A file path is relative to its folder: 2023/IMG_1.jpg.')
  }
  const relative = cleanAgentPath(`/${path}`).slice(1)
  if (!relative) throw new AgentError('A file path is relative to its folder: 2023/IMG_1.jpg.')
  return relative
}

const globs = (value: unknown): string[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50 || !value.every((g) => typeof g === 'string' && g.length > 0 && g.length <= 200)) {
    throw new AgentError('Globs are up to 50 patterns of up to 200 characters.')
  }
  return value as string[]
}

export async function addRoot(db: D1Database, sourceId: string, input: Record<string, unknown>): Promise<RootRow> {
  const path = cleanAgentPath(input.path)
  const id = randomId()
  const existing = await db.prepare('SELECT id FROM source_roots WHERE source_id = ? AND path = ?').bind(sourceId, path).first()
  if (existing) throw new AgentError('That folder is already indexed.', 409)
  // Nested folders would index the same files twice under two keys.
  const roots = await listRoots(db, sourceId)
  if (roots.some((r) => (within(path, r.path) || within(r.path, path)) && path !== r.path)) throw new AgentError('That folder is inside, or contains, a folder already indexed.', 409)
  const source = await getSource(db, sourceId)
  // Only a folder the agent offered, or one inside it (review B5): otherwise anyone who may manage
  // sources could index any path on a paired computer, a person's whole home folder. (Windows paths
  // and shares compare without case, as Windows does.)
  const fold = (p: string) => (/^[A-Z]:\/|^\/\//.test(p) ? p.toLowerCase() : p)
  const offered = json<string[]>(source?.folders ?? '[]', [])
  if (!offered.some((f) => within(fold(path), fold(f)))) throw new AgentError('Choose one of the folders the agent offers, or a folder inside one.', 400)
  // On a volume the agent reported (a USB drive, a mounted share)? Remember which, to find it again.
  const volumes = json<Volume[]>(source?.volumes ?? '[]', [])
  const volume = volumes.filter((v) => within(path, v.path)).sort((a, b) => b.path.length - a.path.length)[0]
  await db
    .prepare(
      `INSERT INTO source_roots (id, source_id, path, label, include_globs, exclude_globs, volume_id, volume_label, volume_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, sourceId, path, shortText(input.label, 100) ?? volume?.label ?? null, JSON.stringify(globs(input.include)), JSON.stringify(globs(input.exclude)), volume?.id ?? null, volume?.label ?? null, volume?.path ?? null, nowIso())
    .run()
  return (await db.prepare('SELECT * FROM source_roots WHERE id = ?').bind(id).first<RootRow>())!
}

export async function updateRoot(db: D1Database, sourceId: string, rootId: string, input: { label?: unknown; include?: unknown; exclude?: unknown; enabled?: unknown }): Promise<RootRow | null> {
  const sets: string[] = []
  const params: unknown[] = []
  if (input.label !== undefined) {
    sets.push('label = ?')
    params.push(shortText(input.label, 100))
  }
  if (input.include !== undefined) {
    sets.push('include_globs = ?')
    params.push(JSON.stringify(globs(input.include)))
  }
  if (input.exclude !== undefined) {
    sets.push('exclude_globs = ?')
    params.push(JSON.stringify(globs(input.exclude)))
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw new AgentError('enabled is true or false.')
    sets.push('enabled = ?')
    params.push(input.enabled ? 1 : 0)
  }
  if (sets.length > 0) await db.prepare(`UPDATE source_roots SET ${sets.join(', ')} WHERE id = ? AND source_id = ?`).bind(...params, rootId, sourceId).run()
  return db.prepare('SELECT * FROM source_roots WHERE id = ? AND source_id = ?').bind(rootId, sourceId).first<RootRow>()
}

/** Stop indexing a folder. Its photos stay in the catalogue, marked missing from the NAS. */
export async function removeRoot(db: D1Database, source: SourceRow, rootId: string): Promise<boolean> {
  const root = await db.prepare('SELECT * FROM source_roots WHERE id = ? AND source_id = ?').bind(rootId, source.id).first<RootRow>()
  if (!root) return false
  await db.batch([
    db
      // Keys under the folder, as a range: 'E:/x/' up to 'E:/x0' ('0' follows '/'). (A substr with a
      // JS length would miscount any folder name with an emoji in it.)
      .prepare(`UPDATE asset_locations SET state = 'missing', updated_at = ? WHERE connection_id = ? AND key >= ? AND key < ?`)
      .bind(nowIso(), source.connection_id, prefixOf(root.path), `${prefixOf(root.path).slice(0, -1)}0`),
    db.prepare('DELETE FROM source_roots WHERE id = ?').bind(rootId),
  ])
  return true
}

/** Revoke an agent: its key stops working at once. Its photos stay, still pointing at the NAS. */
export async function revokeSource(db: D1Database, id: string): Promise<boolean> {
  const source = await getSource(db, id)
  if (!source || source.revoked_at) return false
  await db.prepare('UPDATE sources SET revoked_at = ?, key_hash = NULL WHERE id = ?').bind(nowIso(), id).run()
  return true
}

/** The heartbeat: what the agent is doing. The reply tells it to pause or rescan. */
export async function heartbeat(db: D1Database, source: SourceRow, input: { version?: unknown; platform?: unknown; status?: unknown }) {
  const status = typeof input.status === 'object' && input.status !== null ? JSON.stringify(input.status).slice(0, 8000) : source.status
  await db
    .prepare('UPDATE sources SET last_seen_at = ?, version = COALESCE(?, version), platform = COALESCE(?, platform), status = ?, rescan = 0 WHERE id = ?')
    .bind(nowIso(), shortText(input.version, 40), shortText(input.platform, 40), status.startsWith('{') ? status : '{}', source.id)
    .run()
  return { paused: source.paused === 1, rescan: source.rescan === 1 }
}

export async function reportFolders(db: D1Database, source: SourceRow, folders: unknown, volumes: unknown = []): Promise<number> {
  if (!Array.isArray(folders) || folders.length > 500) throw new AgentError('folders is a list of up to 500 paths.')
  if (!Array.isArray(volumes) || volumes.length > 100) throw new AgentError('volumes is a list of up to 100 volumes.')
  const clean = [...new Set(folders.map(cleanAgentPath))].sort()
  const vols: Volume[] = volumes.map((v) => {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
    const id = shortText(o.id, 200)
    if (!id) throw new AgentError('Each volume needs an id.')
    return { id, label: shortText(o.label, 100), path: cleanAgentPath(o.path), removable: o.removable === true }
  })
  await db.prepare('UPDATE sources SET folders = ?, volumes = ? WHERE id = ?').bind(JSON.stringify(clean), JSON.stringify(vols), source.id).run()
  return clean.length
}

/** The agent couldn't reach a folder (drive unplugged, share unmounted), or reached it again. */
export async function setRootOnline(db: D1Database, source: SourceRow, rootId: string, online: unknown): Promise<{ offlineSince: string | null }> {
  if (typeof online !== 'boolean') throw new AgentError('online is true or false.')
  const root = await db.prepare('SELECT * FROM source_roots WHERE id = ? AND source_id = ?').bind(rootId, source.id).first<RootRow>()
  if (!root) throw new AgentError('Unknown root.', 404)
  const since = online ? null : (root.offline_since ?? nowIso())
  await db.prepare('UPDATE source_roots SET offline_since = ? WHERE id = ?').bind(since, root.id).run()
  return { offlineSince: since }
}

export async function agentConfig(db: D1Database, source: SourceRow) {
  const all = await listRoots(db, source.id)
  return {
    source: { id: source.id, name: source.name, paused: source.paused === 1 },
    roots: all.filter((r) => r.enabled === 1).map(rootJson),
    // Every folder, switched off or not: the agent keeps what it knows about a folder that's only off.
    knownRoots: all.map((r) => r.id),
    scanIntervalMinutes: SCAN_INTERVAL_MINUTES,
    defaultExcludes: DEFAULT_EXCLUDES,
    archive: archiveConfig(source),
  }
}

// ── Ingest ───────────────────────────────────────────────────────────────────

export interface IngestResult {
  path: string
  assetId?: string
  result: 'created' | 'updated' | 'unchanged' | 'moved' | 'rejected'
  needs?: ('thumb' | 'preview')[]
  /** False when the asset was never finished (the agent stopped before completing it): complete it now. */
  ready?: boolean
  error?: string
}

interface LocationMatch {
  asset_id: string
  key: string
  size: number | null
  quick_hash: string | null
  state: string
  updated_at: string
  /** The asset's status, and which previews it has: for telling the agent what it still needs. */
  status: string
  have: string | null
}

interface IngestItem {
  rel: string
  key: string
  size: number
  quickHash: string
  mtime: string | null
  previousKey: string | null
  mimeType: string | undefined
  metadata: unknown
}

const HEX64 = /^[0-9a-f]{64}$/

const isUniqueViolation = (error: unknown) => error instanceof Error && /UNIQUE constraint failed/i.test(error.message)

/**
 * One batch of files from a scan. Each item: the root it is in, its path inside that root, size,
 * mtime, quick fingerprint, metadata as the agent read it, and optionally where it used to be
 * (`previousPath`, in `previousRoot` when it moved between folders; the same root otherwise).
 *
 * A fixed number of round trips whatever the batch holds: one read of every location the items could
 * match, the keywords they bring (see metadataLookups), and one batch of writes, which D1 runs as a
 * transaction. When another request created one of the same new files meanwhile, the unique index
 * on present NAS paths fails the batch, and it is worked out again from what is there now.
 */
export async function ingestBatch(env: DamBindings, source: SourceRow, items: unknown): Promise<IngestResult[]> {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH) throw new AgentError(`Send 1 to ${MAX_BATCH} items at a time.`)
  const roots = new Map((await listRoots(env.DB, source.id)).map((r) => [r.id, r]))
  const parsed = items.map((raw): IngestItem | IngestResult => {
    const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    try {
      return parseIngestItem(roots, item)
    } catch (error) {
      if (!(error instanceof AgentError)) throw error
      return { path: typeof item.path === 'string' ? item.path.slice(0, 200) : '?', result: 'rejected', error: error.message }
    }
  })
  try {
    return await ingestParsed(env, source, parsed)
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    return ingestParsed(env, source, parsed)
  }
}

function parseIngestItem(roots: Map<string, RootRow>, item: Record<string, unknown>): IngestItem {
  const rootOf = (id: unknown) => {
    const root = typeof id === 'string' ? roots.get(id) : undefined
    if (!root || root.enabled !== 1) throw new AgentError('Unknown or disabled root.')
    return root
  }
  const root = rootOf(item.root)
  const rel = cleanRelativePath(item.path)
  const size = item.size
  if (!Number.isSafeInteger(size) || (size as number) < 0) throw new AgentError('size is a whole number of bytes.')
  const quickHash = typeof item.quickHash === 'string' && HEX64.test(item.quickHash) ? item.quickHash : null
  if (!quickHash) throw new AgentError('quickHash is 64 lower-case hex characters.')
  const mtime = typeof item.mtime === 'string' && !Number.isNaN(Date.parse(item.mtime)) ? new Date(item.mtime).toISOString() : null
  const previousKey = item.previousPath !== undefined ? keyOf(rootOf(item.previousRoot ?? item.root).path, cleanRelativePath(item.previousPath)) : null
  return {
    rel,
    key: keyOf(root.path, rel),
    size: size as number,
    quickHash,
    mtime,
    previousKey,
    mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
    metadata: item.metadata,
  }
}

async function ingestParsed(env: DamBindings, source: SourceRow, parsed: (IngestItem | IngestResult)[]): Promise<IngestResult[]> {
  const db = env.DB
  const conn = source.connection_id
  const items = parsed.filter((p): p is IngestItem => 'quickHash' in p)
  const now = nowIso()

  // Every row the items could be: at their paths, at the paths they say they came from, or missing
  // with the same fingerprint.
  const { results: rows } = items.length
    ? await db
        .prepare(
          `SELECT l.asset_id, l.key, l.size, l.quick_hash, l.state, l.updated_at, a.status,
                  (SELECT GROUP_CONCAT(name) FROM renditions WHERE asset_id = l.asset_id AND name IN ('thumb', 'preview')) AS have
           FROM asset_locations l JOIN assets a ON a.id = l.asset_id
           WHERE l.rowid IN (
             SELECT rowid FROM asset_locations WHERE connection_id = ? AND key IN (SELECT value FROM json_each(?))
             UNION SELECT rowid FROM asset_locations WHERE connection_id = ? AND quick_hash IN (SELECT value FROM json_each(?)) AND state = 'missing'
           )`,
        )
        .bind(conn, JSON.stringify(items.flatMap((i) => (i.previousKey ? [i.key, i.previousKey] : [i.key]))), conn, JSON.stringify(items.map((i) => i.quickHash)))
        .all<LocationMatch>()
    : { results: [] as LocationMatch[] }

  // Decided in order, as the one-at-a-time version would: a row an earlier item took is where that item put it.
  const newest = (a: LocationMatch, b: LocationMatch) => b.updated_at.localeCompare(a.updated_at)
  const at = (k: string) => rows.filter((r) => r.key === k).sort((a, b) => Number(b.state === 'present') - Number(a.state === 'present') || newest(a, b))
  const standing = (r: LocationMatch) => {
    const have = new Set((r.have ?? '').split(','))
    return { needs: (['thumb', 'preview'] as const).filter((n) => !have.has(n)), ready: r.status === 'ready' }
  }
  const touches: LocationMatch[] = []
  const take = (r: LocationMatch, item: IngestItem) => {
    Object.assign(r, { key: item.key, size: item.size, quick_hash: item.quickHash, state: 'present', updated_at: now })
    touches.push(r)
    return r
  }
  const created: { assetId: string; item: IngestItem; filename: string }[] = []
  const changed: { assetId: string; item: IngestItem }[] = []
  const renamed: { assetId: string; filename: string }[] = []

  const decide = (item: IngestItem): IngestResult => {
    const same = (l: LocationMatch) => l.quick_hash === item.quickHash && l.size === item.size
    const here = at(item.key).find((r) => r.state === 'present')
    if (here) {
      // 1. Known path, same file.
      if (same(here)) return { path: item.rel, assetId: take(here, item).asset_id, result: 'unchanged', ...standing(here) }
      // The file changed (re-saved, re-exported): new size and fingerprint, what the file says about
      // itself (size, date, camera) replaced, fresh renditions.
      take(here, item).status = 'processing'
      changed.push({ assetId: here.asset_id, item })
      return { path: item.rel, assetId: here.asset_id, result: 'updated', needs: ['thumb', 'preview'], ready: false }
    }
    // 2. A file that was missing is back where it was (a share that dropped, a folder restored).
    // A different file now saved under a missing photo's name is a new photo; the old one stays missing.
    const back = at(item.key).find(same)
    if (back) return { path: item.rel, assetId: take(back, item).asset_id, result: 'unchanged', ...standing(back) }

    // 3. Moved or renamed: the agent says where it was, or the same file went missing from this agent.
    const previous = item.previousKey ? at(item.previousKey).find(same) : undefined
    const moved = previous ?? rows.filter((r) => r.state === 'missing' && same(r)).sort(newest)[0]
    if (moved) {
      take(moved, item)
      renamed.push({ assetId: moved.asset_id, filename: safeFilename(item.rel) })
      return { path: item.rel, assetId: moved.asset_id, result: 'moved', ...standing(moved) }
    }

    // 4. New to the catalogue.
    const assetId = randomId()
    created.push({ assetId, item, filename: safeFilename(item.rel) })
    rows.push({ asset_id: assetId, key: item.key, size: item.size, quick_hash: item.quickHash, state: 'present', updated_at: now, status: 'processing', have: null })
    return { path: item.rel, assetId, result: 'created', needs: ['thumb', 'preview'], ready: false }
  }
  const results = parsed.map((p) => ('quickHash' in p ? decide(p) : p))

  const metas = [
    ...created.map((c) => ({ assetId: c.assetId, meta: normalizeAgentMetadata(c.item.metadata), fileChanged: false })),
    ...changed.map((c) => ({ assetId: c.assetId, meta: normalizeAgentMetadata(c.item.metadata), fileChanged: true })),
  ].filter((m): m is { assetId: string; meta: NonNullable<typeof m.meta>; fileChanged: boolean } => m.meta !== null)
  const lookups = await metadataLookups(db, metas.map((m) => m.meta))

  const field = (name: string) => `json_extract(j.value, '$.${name}')`
  const statements: D1PreparedStatement[] = []
  if (created.length > 0) {
    const list = JSON.stringify(
      created.map((c) => ({ id: c.assetId, filename: c.filename, mime: mimeTypeFor(c.filename, c.item.mimeType), key: c.item.key, size: c.item.size, mtime: c.item.mtime, hash: c.item.quickHash })),
    )
    statements.push(
      db
        .prepare(
          `INSERT INTO assets (id, owner_id, filename, mime_type, size, status, created_at, updated_at)
           SELECT ${field('id')}, (SELECT created_by FROM sources WHERE id = ?), ${field('filename')}, ${field('mime')}, ${field('size')}, 'processing', ?, ? FROM json_each(?) j`,
        )
        .bind(source.id, now, now, list),
      db
        .prepare(
          `INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, size, mtime, quick_hash, seen_at, updated_at)
           SELECT ${field('id')}, ?, ${field('key')}, 'NAS', 'present', ${field('size')}, ${field('mtime')}, ${field('hash')}, ?, ? FROM json_each(?) j`,
        )
        .bind(conn, now, now, list),
    )
  }
  if (touches.length > 0) {
    const byAsset = new Map(touches.map((t) => [t.asset_id, t]))
    const mtimes = new Map(items.map((i) => [i.key, i.mtime]))
    statements.push(
      db
        .prepare(
          `UPDATE asset_locations SET key = ${field('key')}, size = ${field('size')}, mtime = ${field('mtime')}, quick_hash = ${field('hash')}, seen_at = ?, state = 'present', updated_at = ?
           FROM json_each(?) j WHERE asset_locations.asset_id = ${field('id')} AND asset_locations.connection_id = ?`,
        )
        .bind(now, now, JSON.stringify([...byAsset.values()].map((t) => ({ id: t.asset_id, key: t.key, size: t.size, mtime: mtimes.get(t.key) ?? null, hash: t.quick_hash }))), conn),
    )
  }
  if (changed.length > 0) {
    statements.push(
      db
        .prepare(`UPDATE assets SET size = ${field('size')}, status = 'processing', phash = NULL, updated_at = ? FROM json_each(?) j WHERE assets.id = ${field('id')}`)
        .bind(now, JSON.stringify(changed.map((c) => ({ id: c.assetId, size: c.item.size })))),
    )
  }
  if (renamed.length > 0) {
    statements.push(
      db
        .prepare(`UPDATE assets SET filename = ${field('filename')}, updated_at = ? FROM json_each(?) j WHERE assets.id = ${field('id')}`)
        .bind(now, JSON.stringify(renamed.map((r) => ({ id: r.assetId, filename: r.filename })))),
    )
  }
  for (const m of metas) statements.push(...metadataStatements(db, m.assetId, m.meta, lookups, { fileChanged: m.fileChanged }))
  if (statements.length > 0) await db.batch(statements)
  return results
}

/** Assets this agent may touch: those with a location on its connection. */
export async function ownsAsset(db: D1Database, source: SourceRow, assetId: string): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS yes FROM asset_locations WHERE asset_id = ? AND connection_id = ?').bind(assetId, source.connection_id).first()) !== null
}

const HEX16 = /^[0-9a-f]{16}$/

/**
 * After renditions are up: finish each asset (hash, presets, places, AI, index, ready). An agent's
 * first scan of a folder doesn't queue AI review; that is a cost people start on purpose.
 * All at once; if that fails, one at a time, so one asset that can't be finished doesn't fail the
 * others (it stays 'processing' for the sweep).
 */
export async function completeAssets(env: DamBindings, source: SourceRow, items: unknown): Promise<{ id: string; status: 'ready' | 'rejected' | 'failed'; error?: string }[]> {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH) throw new AgentError(`Send 1 to ${MAX_BATCH} items at a time.`)
  const roots = await listRoots(env.DB, source.id)
  const wanted = items.map((raw) => {
    const item = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    return { id: typeof item.id === 'string' ? item.id : '', hash: typeof item.phash === 'string' && HEX16.test(item.phash) ? item.phash : null }
  })
  const { results: locations } = await env.DB.prepare('SELECT asset_id, key FROM asset_locations WHERE connection_id = ? AND asset_id IN (SELECT value FROM json_each(?))')
    .bind(source.connection_id, JSON.stringify(wanted.map((w) => w.id)))
    .all<{ asset_id: string; key: string }>()
  const keys = new Map(locations.map((l) => [l.asset_id, l.key]))
  const finish = [...new Map(wanted.filter((w) => keys.has(w.id)).map((w) => [w.id, w])).values()].map((w) => {
    const key = keys.get(w.id)!
    const root = roots.find((r) => key.startsWith(prefixOf(r.path)))
    return { id: w.id, hash: w.hash, queueAi: Boolean(root?.first_scan_done_at) }
  })
  const failed = new Set<string>()
  try {
    await finishAssets(env, finish)
  } catch (error) {
    console.error('[agent] could not finish the batch; trying one at a time', error)
    for (const f of finish) {
      await finishAssets(env, [f]).catch((e) => {
        console.error('[agent] could not finish', f.id, e)
        failed.add(f.id)
      })
    }
  }
  return wanted.map(({ id }) =>
    !keys.has(id)
      ? { id, status: 'rejected' as const, error: 'Not one of this agent’s files.' }
      : failed.has(id)
        ? { id, status: 'failed' as const, error: 'cf-dam could not finish this photo; it will try again.' }
        : { id, status: 'ready' as const },
  )
}

/**
 * A full scan of a root finished. The agent lists the files it knew that are gone (it sends only new
 * and changed files, so the server can't infer absence). They stay in the catalogue, marked missing
 * from the NAS: moved somewhere unindexed, or deleted. Never deleted here.
 */
export async function completeScan(db: D1Database, source: SourceRow, input: Record<string, unknown>): Promise<{ missing: number }> {
  const root = typeof input.root === 'string' ? await db.prepare('SELECT * FROM source_roots WHERE id = ? AND source_id = ?').bind(input.root, source.id).first<RootRow>() : null
  if (!root) throw new AgentError('Unknown root.', 404)
  const missing = input.missing ?? []
  if (!Array.isArray(missing) || missing.length > 5000) throw new AgentError('missing is a list of up to 5,000 paths; send more in further calls.')
  const keys = missing.map((p) => keyOf(root.path, cleanRelativePath(p)))
  const now = nowIso()
  // In lists of 500 (a key is at most about 2 KB, a bound value at most 2 MB), all in one batch.
  const chunks = Array.from({ length: Math.ceil(keys.length / 500) }, (_, i) => keys.slice(i * 500, (i + 1) * 500))
  const marked = chunks.length
    ? (
        await db.batch(
          chunks.map((chunk) =>
            db
              .prepare(`UPDATE asset_locations SET state = 'missing', updated_at = ? WHERE connection_id = ? AND state = 'present' AND key IN (SELECT value FROM json_each(?))`)
              .bind(now, source.connection_id, JSON.stringify(chunk)),
          ),
        )
      ).reduce((n, r) => n + r.meta.changes, 0)
    : 0
  if (input.final !== false) {
    await db.prepare('UPDATE source_roots SET last_scan_at = ?, first_scan_done_at = COALESCE(first_scan_done_at, ?) WHERE id = ?').bind(now, now, root.id).run()
  }
  return { missing: marked }
}

/** The agent folder a NAS location belongs to, for showing where it is and whether it is offline. */
export async function folderOf(db: D1Database, connectionId: string, key: string): Promise<{ sourceName: string; root: ReturnType<typeof rootJson> } | null> {
  const source = await db.prepare('SELECT id, name FROM sources WHERE connection_id = ?').bind(connectionId).first<{ id: string; name: string }>()
  if (!source) return null
  const root = (await listRoots(db, source.id)).filter((r) => within(key, r.path)).sort((a, b) => b.path.length - a.path.length)[0]
  return root ? { sourceName: source.name, root: rootJson(root) } : null
}
