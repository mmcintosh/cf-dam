import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import { AI_OFF, aiStats, getAiSettings, queueForAi, saveAiSettings, type AiSettings } from '../catalog/ai'
import { nudge } from '../catalog/work'
import { USD_PER_1000_NEURONS, VISION_MODELS } from '../catalog/vision'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject } from '../lib/http'
import { say } from '../lib/language'

export const aiRoutes = new Hono<DamEnv>()

/** Settings, the models on offer, and the backlog with its estimated cost. */
aiRoutes.get('/', requirePermission('ai:run'), async (c) => {
  const [settings, stats] = await Promise.all([getAiSettings(c.env.DB), aiStats(c.env.DB)])
  return c.json({ available: Boolean(c.env.AI), settings, models: VISION_MODELS, stats, usdPer1000Neurons: USD_PER_1000_NEURONS })
})

aiRoutes.put('/settings', requirePermission('settings:manage'), async (c) => {
  try {
    const body = await readJsonObject(c)
    const patch: Partial<AiSettings> = {}
    for (const flag of ['enabled', 'auto'] as const) {
      if (body[flag] === undefined) continue
      if (typeof body[flag] !== 'boolean') throw new BadRequest(`${flag} must be true or false.`)
      patch[flag] = body[flag]
    }
    if (body.model !== undefined) {
      if (typeof body.model !== 'string' || !VISION_MODELS.some((m) => m.id === body.model)) throw new BadRequest(say('err.unknownModel'))
      patch.model = body.model
    }
    if (body.context !== undefined) {
      if (typeof body.context !== 'string' || body.context.length > 500) throw new BadRequest('context is text up to 500 characters.')
      patch.context = body.context.trim()
    }
    const settings = await saveAiSettings(c.env.DB, patch)
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'ai.settings_changed', details: patch })
    return c.json({ settings })
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

/** Queue every photo that has never been analysed (or failed). The sweep works through them. */
aiRoutes.post('/backfill', requirePermission('ai:run'), async (c) => {
  if (!c.env.AI) return c.json({ error: 'ai_unavailable', message: say('err.noAi') }, 409)
  // Queued while switched off, photos would wait with nothing to analyse them.
  if (!(await getAiSettings(c.env.DB)).enabled) return c.json({ error: 'ai_off', message: AI_OFF }, 409)
  const queued = await queueForAi(c.env.DB, 'unanalysed')
  await nudge(c.env, 'ai', queued)
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'ai.backfill_queued', details: { queued } })
  return c.json({ queued, stats: await aiStats(c.env.DB) })
})
