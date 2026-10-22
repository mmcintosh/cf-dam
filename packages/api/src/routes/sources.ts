/** People managing NAS agents: approve a pairing code, choose folders, pause, rescan, revoke. */
import { Hono, type Context } from 'hono'
import { requirePermission } from '../auth/principal'
import {
  addRoot,
  AgentError,
  approvePairing,
  getSource,
  listRoots,
  pendingPairing,
  reconnectableSources,
  removeRoot,
  revokeSource,
  rootJson,
  updateRoot,
  type SourceRow,
} from '../catalog/agents'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { parseArchiveSettings, validArchiveSettings } from '../catalog/archive'
import { BadRequest, readJsonObject } from '../lib/http'

export const sourceRoutes = new Hono<DamEnv>()
sourceRoutes.use('*', requirePermission('sources:manage'))

function failure(c: Context<DamEnv>, error: unknown) {
  if (error instanceof AgentError) return c.json({ error: 'invalid_request', message: error.message }, error.status)
  if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
  throw error
}

const parse = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/** An agent is online if it sent a heartbeat in the last three minutes. */
const ONLINE_MS = 3 * 60_000

async function sourceJson(db: D1Database, s: SourceRow) {
  const [roots, counts] = await Promise.all([
    listRoots(db, s.id),
    db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN l.state = 'missing' THEN 1 ELSE 0 END) AS missing,
                SUM(CASE WHEN a.status = 'processing' THEN 1 ELSE 0 END) AS processing
         FROM asset_locations l JOIN assets a ON a.id = l.asset_id AND a.deleted_at IS NULL WHERE l.connection_id = ?`,
      )
      .bind(s.connection_id)
      .first<{ total: number; missing: number | null; processing: number | null }>(),
  ])
  return {
    id: s.id,
    name: s.name,
    platform: s.platform,
    version: s.version,
    lastSeenAt: s.last_seen_at,
    online: !!s.last_seen_at && Date.now() - Date.parse(s.last_seen_at) < ONLINE_MS,
    paused: s.paused === 1,
    revoked: s.revoked_at !== null,
    // Back from a backup without its key: waiting for its agent to pair again.
    waiting: s.revoked_at === null && !s.key_hash,
    status: parse<Record<string, unknown>>(s.status, {}),
    folders: parse<string[]>(s.folders, []),
    volumes: parse<{ id: string; label: string | null; path: string; removable: boolean }[]>(s.volumes, []),
    roots: roots.map(rootJson),
    archive: parseArchiveSettings(s.archive),
    photos: { total: counts?.total ?? 0, missing: counts?.missing ?? 0, processing: counts?.processing ?? 0 },
    createdAt: s.created_at,
  }
}

sourceRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM sources ORDER BY revoked_at IS NOT NULL, created_at').all<SourceRow>()
  return c.json({ sources: await Promise.all(results.map((s) => sourceJson(c.env.DB, s))) })
})

/** Look a code up before approving, so people see which agent is asking. */
sourceRoutes.get('/pair/:code', async (c) => {
  const row = await pendingPairing(c.env.DB, c.req.param('code'))
  if (!row) return c.json({ error: 'not_found', message: 'That code is unknown or has expired.' }, 404)
  // Entries waiting for their agent (after a restore); the one this agent says it had first.
  const waiting = await reconnectableSources(c.env.DB)
  const previous = waiting.find((s) => s.id === row.previous_source_id) ?? null
  return c.json({ name: row.name, platform: row.platform, version: row.version, expiresAt: row.expires_at, previous, reconnectable: waiting })
})

sourceRoutes.post('/pair', async (c) => {
  try {
    const body = await readJsonObject(c)
    if (typeof body.code !== 'string') throw new BadRequest('code is required.')
    const principal = c.get('principal')!
    const sourceId = typeof body.sourceId === 'string' && body.sourceId ? body.sourceId : null
    const source = await approvePairing(c.env, body.code, { name: typeof body.name === 'string' ? body.name : null, userId: principal.userId, sourceId })
    await logActivity(c.env.DB, { userId: principal.userId, action: sourceId ? 'source.reconnected' : 'source.paired', targetType: 'source', targetId: source.id, details: { name: source.name } })
    return c.json({ source: await sourceJson(c.env.DB, (await getSource(c.env.DB, source.id))!) }, 201)
  } catch (error) {
    return failure(c, error)
  }
})

async function loadSource(c: Context<DamEnv>): Promise<SourceRow | null> {
  return getSource(c.env.DB, c.req.param('id')!)
}

sourceRoutes.patch('/:id', async (c) => {
  const source = await loadSource(c)
  if (!source) return c.json({ error: 'not_found' }, 404)
  try {
    const body = await readJsonObject(c)
    const sets: string[] = []
    const params: unknown[] = []
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) throw new BadRequest('name is 1–80 characters.')
      sets.push('name = ?')
      params.push(body.name.trim())
      // The connection carries the same name, shown wherever an original's location is.
      await c.env.DB.prepare('UPDATE storage_connections SET name = ? WHERE id = ?').bind(body.name.trim(), source.connection_id).run()
    }
    if (body.paused !== undefined) {
      if (typeof body.paused !== 'boolean') throw new BadRequest('paused is true or false.')
      sets.push('paused = ?')
      params.push(body.paused ? 1 : 0)
    }
    if (body.archive !== undefined) {
      sets.push('archive = ?')
      params.push(JSON.stringify(await validArchiveSettings(c.env.DB, body.archive)))
    }
    if (sets.length > 0) await c.env.DB.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).bind(...params, source.id).run()
    return c.json({ source: await sourceJson(c.env.DB, (await loadSource(c))!) })
  } catch (error) {
    return failure(c, error)
  }
})

sourceRoutes.post('/:id/rescan', async (c) => {
  const source = await loadSource(c)
  if (!source) return c.json({ error: 'not_found' }, 404)
  await c.env.DB.prepare('UPDATE sources SET rescan = 1 WHERE id = ?').bind(source.id).run()
  return c.json({ ok: true })
})

sourceRoutes.delete('/:id', async (c) => {
  if (!(await revokeSource(c.env.DB, c.req.param('id')))) return c.json({ error: 'not_found' }, 404)
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'source.revoked', targetType: 'source', targetId: c.req.param('id') })
  return c.body(null, 204)
})

sourceRoutes.post('/:id/roots', async (c) => {
  const source = await loadSource(c)
  if (!source || source.revoked_at) return c.json({ error: 'not_found' }, 404)
  try {
    const root = await addRoot(c.env.DB, source.id, await readJsonObject(c))
    return c.json({ root: rootJson(root) }, 201)
  } catch (error) {
    return failure(c, error)
  }
})

sourceRoutes.patch('/:id/roots/:rootId', async (c) => {
  const source = await loadSource(c)
  if (!source) return c.json({ error: 'not_found' }, 404)
  try {
    const root = await updateRoot(c.env.DB, source.id, c.req.param('rootId'), await readJsonObject(c))
    return root ? c.json({ root: rootJson(root) }) : c.json({ error: 'not_found' }, 404)
  } catch (error) {
    return failure(c, error)
  }
})

sourceRoutes.delete('/:id/roots/:rootId', async (c) => {
  const source = await loadSource(c)
  if (!source || !(await removeRoot(c.env.DB, source, c.req.param('rootId')))) return c.json({ error: 'not_found' }, 404)
  return c.body(null, 204)
})

/**
 * The agent image the compose file names: a tag the agent's release workflow publishes
 * (.github/workflows/agent.yml). Before 1.0 that's major.minor; there is no '0'.
 */
export const AGENT_IMAGE_TAG = '0.1'

/**
 * Where each kind of NAS keeps shared folders and container data, and where the compose file goes. The
 * paths are examples the page tells people to change; the folders end up under /photos either way.
 */
export const NAS_KINDS = {
  synology: { photos: '/volume1/photo', data: '/volume1/docker/cf-dam-agent', where: 'In Synology Container Manager: Project → Create → paste this.' },
  qnap: { photos: '/share/Multimedia', data: '/share/Container/cf-dam-agent', where: 'In QNAP Container Station: Applications → Create → paste this.' },
  ugreen: { photos: '/volume1/Photos', data: '/volume1/docker/cf-dam-agent', where: 'In the UGREEN Docker app: create a project and paste this.' },
  terramaster: { photos: '/Volume1/Photos', data: '/Volume1/docker/cf-dam-agent', where: 'In TerraMaster Docker Manager: create a project (compose) and paste this.' },
  asustor: { photos: '/volume1/Photos', data: '/volume1/Docker/cf-dam-agent', where: 'In Portainer (from App Central): Stacks → Add stack → paste this.' },
  truenas: { photos: '/mnt/tank/photos', data: '/mnt/tank/apps/cf-dam-agent', where: 'In TrueNAS (24.10 or later): Apps → Discover Apps → ⋮ → Install via YAML → paste this.' },
  unraid: { photos: '/mnt/user/photos', data: '/mnt/user/appdata/cf-dam-agent', where: 'On Unraid with the Compose Manager plugin: Add New Stack → paste this.' },
  omv: { photos: '/srv/dev-disk-by-uuid-1234/photos', data: '/srv/dev-disk-by-uuid-1234/appdata/cf-dam-agent', where: 'In OpenMediaVault (with omv-extras): Services → Compose → Files → Add → paste this.' },
  linux: { photos: '/home/me/Pictures', data: './data', where: 'Save as docker-compose.yml, then run: docker compose up -d' },
} as const
export type NasKind = keyof typeof NAS_KINDS

/** The compose file for this deployment and that kind of NAS (`?nas=`, Synology when absent). */
sourceRoutes.get('/compose', (c) => {
  const url = new URL(c.req.url).origin
  const asked = c.req.query('nas') ?? 'synology'
  const nas = NAS_KINDS[(asked in NAS_KINDS ? asked : 'synology') as NasKind]
  const folder = nas.photos.slice(nas.photos.lastIndexOf('/') + 1).toLowerCase()
  const yaml = `# cf-dam NAS agent. ${nas.where}
# Add one line under volumes for each shared folder to index, always ending in :ro (read-only).
services:
  cf-dam-agent:
    # For video previews too, use cf-dam-agent:${AGENT_IMAGE_TAG}-video (about 465 MB larger).
    image: ghcr.io/mmcintosh/cf-dam-agent:${AGENT_IMAGE_TAG}
    restart: unless-stopped
    environment:
      CF_DAM_URL: ${url}
    volumes:
      - ${nas.photos}:/photos/${folder}:ro
      - ${nas.data}:/data
    ports:
      - "8790:8790"
    cpu_shares: 256
    mem_limit: 1g
`
  return c.text(yaml, 200, { 'Content-Type': 'text/yaml; charset=utf-8' })
})
