/** Missing previews, for the Storage page (catalog/previews.ts does the work). Needs `sources:manage`. */
import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import { previewStatus, requestPreviews, startPreviewCheck } from '../catalog/previews'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { say } from '../lib/language'

export const previewRoutes = new Hono<DamEnv>()

previewRoutes.use('*', requirePermission('sources:manage'))

previewRoutes.get('/', async (c) => c.json(await previewStatus(c.env.DB)))

/** Ask R2 about every preview the catalog lists, and have missing ones made again. */
previewRoutes.post('/check', async (c) => {
  if (!(await startPreviewCheck(c.env.DB))) return c.json({ error: 'already_running', message: say('err.checkRunning') }, 409)
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'previews.check_started' })
  return c.json(await previewStatus(c.env.DB), 202)
})

/** Try again for photos that couldn't be done (an original restored from Glacier since, say). */
previewRoutes.post('/retry', async (c) => {
  const { results } = await c.env.DB.prepare("SELECT asset_id FROM preview_requests WHERE route IN ('archived', 'unreadable')").all<{ asset_id: string }>()
  await requestPreviews(c.env.DB, results.map((r) => r.asset_id))
  return c.json(await previewStatus(c.env.DB))
})
