import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import { dismissPairs, duplicateCounts, exactGroups, keepOne, similarGroups } from '../catalog/duplicates'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject, requiredString, stringArray } from '../lib/http'
import { say } from '../lib/language'

export const duplicateRoutes = new Hono<DamEnv>()

duplicateRoutes.get('/counts', requirePermission('assets:read'), async (c) => c.json(await duplicateCounts(c.env.DB)))
duplicateRoutes.get('/exact', requirePermission('assets:read'), async (c) => c.json(await exactGroups(c.env.DB)))
duplicateRoutes.get('/similar', requirePermission('assets:read'), async (c) => c.json(await similarGroups(c.env.DB)))

/** Keep one, merge the others' tags, albums, rating and pick into it, soft-delete the others. */
duplicateRoutes.post('/resolve', requirePermission('assets:delete'), async (c) => {
  try {
    const body = await readJsonObject(c)
    const keep = requiredString(body, 'keep', 64)
    const remove = stringArray(body, 'remove') ?? []
    if (remove.length === 0 || remove.length > 100) throw new BadRequest('remove lists 1 to 100 assets.')
    if (!(await c.env.DB.prepare('SELECT 1 FROM assets WHERE id = ? AND deleted_at IS NULL').bind(keep).first())) {
      return c.json({ error: 'not_found', message: say('err.keepMissing') }, 404)
    }
    const removed = await keepOne(c.env.DB, keep, remove)
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'duplicates.resolved', targetType: 'asset', targetId: keep, details: { removed } })
    return c.json({ removed })
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

/** "These aren't duplicates": the whole group, or with `only`, one photo taken out of it. */
duplicateRoutes.post('/dismiss', requirePermission('assets:edit'), async (c) => {
  try {
    const body = await readJsonObject(c)
    const ids = stringArray(body, 'ids') ?? []
    if (ids.length < 2 || ids.length > 100) throw new BadRequest('ids lists 2 to 100 assets.')
    const only = typeof body.only === 'string' ? body.only : undefined
    if (only && !ids.includes(only)) throw new BadRequest('only must be one of ids.')
    return c.json({ dismissed: await dismissPairs(c.env.DB, ids, only) })
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})
