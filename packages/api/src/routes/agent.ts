/**
 * What NAS agents call. Pairing is open (rate-limited); everything else needs the agent's own key,
 * which carries only `agent:sync` and names its source (see auth/principal.ts).
 */
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { requirePermission } from '../auth/principal'
import { consumeRateLimit } from '../auth/rate-limit'
import {
  agentConfig,
  AgentError,
  completeAssets,
  completeScan,
  getSource,
  heartbeat,
  ingestBatch,
  ownsAsset,
  pollPairing,
  reportFolders,
  setRootOnline,
  startPairing,
} from '../catalog/agents'
import { isRenditionName, RenditionRejected, storeAgentRendition } from '../catalog/renditions'
import type { DamEnv } from '../env'
import { BadRequest, readJsonObject } from '../lib/http'

export const agentRoutes = new Hono<DamEnv>()

function failure(c: Context<DamEnv>, error: unknown) {
  if (error instanceof AgentError) return c.json({ error: 'invalid_request', message: error.message }, error.status)
  if (error instanceof BadRequest || error instanceof RenditionRejected) return c.json({ error: 'invalid_request', message: error.message }, 400)
  throw error
}

agentRoutes.post('/pair/start', async (c) => {
  const limited = await consumeRateLimit(c, { max: 10, windowMs: 10 * 60_000, keyPrefix: 'agent-pair' })
  if (limited) return limited
  try {
    const body = await readJsonObject(c)
    const pairing = await startPairing(c.env.DB, { name: body.name, platform: body.platform, version: body.version })
    return c.json({ ...pairing, verificationUrl: new URL('/sources', c.req.url).toString() }, 201)
  } catch (error) {
    return failure(c, error)
  }
})

agentRoutes.post('/pair/poll', async (c) => {
  const limited = await consumeRateLimit(c, { max: 60, windowMs: 60_000, keyPrefix: 'agent-poll' })
  if (limited) return limited
  try {
    const body = await readJsonObject(c)
    if (typeof body.deviceCode !== 'string' || body.deviceCode.length > 100) throw new BadRequest('deviceCode is required.')
    const result = await pollPairing(c.env, body.deviceCode)
    if (result.status === 'pending') return c.json(result, 202)
    if (result.status === 'expired') return c.json(result, 410)
    return c.json(result)
  } catch (error) {
    return failure(c, error)
  }
})

/** The rest needs an agent key; `source` is the agent's own source. */
const asAgent: MiddlewareHandler<DamEnv> = async (c, next) => {
  const sourceId = c.get('principal')?.sourceId
  const source = sourceId ? await getSource(c.env.DB, sourceId) : null
  if (!source || source.revoked_at) return c.json({ error: 'forbidden', message: 'Only a paired agent can call this.' }, 403)
  c.set('source', source)
  await next()
}
/** Writes stop while a person has paused the agent. */
const notPaused: MiddlewareHandler<DamEnv> = async (c, next) => {
  if (c.get('source')!.paused === 1) return c.json({ error: 'paused', message: 'This agent is paused in cf-dam.' }, 409)
  await next()
}

agentRoutes.use('/config', requirePermission('agent:sync'), asAgent)
agentRoutes.use('/heartbeat', requirePermission('agent:sync'), asAgent)
agentRoutes.use('/folders', requirePermission('agent:sync'), asAgent)
agentRoutes.use('/roots/*', requirePermission('agent:sync'), asAgent)
agentRoutes.use('/assets/*', requirePermission('agent:sync'), asAgent, notPaused)
agentRoutes.use('/scans/*', requirePermission('agent:sync'), asAgent, notPaused)

agentRoutes.get('/config', async (c) => c.json(await agentConfig(c.env.DB, c.get('source')!)))

agentRoutes.post('/heartbeat', async (c) => {
  try {
    return c.json(await heartbeat(c.env.DB, c.get('source')!, await readJsonObject(c)))
  } catch (error) {
    return failure(c, error)
  }
})

agentRoutes.post('/folders', async (c) => {
  try {
    const body = await readJsonObject(c)
    return c.json({ folders: await reportFolders(c.env.DB, c.get('source')!, body.folders, body.volumes ?? []) })
  } catch (error) {
    return failure(c, error)
  }
})

agentRoutes.post('/roots/:id/status', async (c) => {
  try {
    const body = await readJsonObject(c)
    return c.json(await setRootOnline(c.env.DB, c.get('source')!, c.req.param('id'), body.online))
  } catch (error) {
    return failure(c, error)
  }
})

agentRoutes.post('/assets/batch', async (c) => {
  try {
    const body = await readJsonObject(c)
    return c.json({ results: await ingestBatch(c.env, c.get('source')!, body.items) })
  } catch (error) {
    return failure(c, error)
  }
})

agentRoutes.put('/assets/:id/renditions/:name', async (c) => {
  const { id, name } = c.req.param()
  if (!isRenditionName(name)) return c.json({ error: 'not_found' }, 404)
  if (!(await ownsAsset(c.env.DB, c.get('source')!, id))) return c.json({ error: 'not_found' }, 404)
  try {
    const size = await storeAgentRendition(c.env, id, name, await c.req.arrayBuffer())
    return c.json(size)
  } catch (error) {
    return failure(c, error)
  }
})

agentRoutes.post('/assets/complete', async (c) => {
  try {
    const body = await readJsonObject(c)
    return c.json({ results: await completeAssets(c.env, c.get('source')!, body.items) })
  } catch (error) {
    return failure(c, error)
  }
})

agentRoutes.post('/scans/complete', async (c) => {
  try {
    return c.json(await completeScan(c.env.DB, c.get('source')!, await readJsonObject(c)))
  } catch (error) {
    return failure(c, error)
  }
})
