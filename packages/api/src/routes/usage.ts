/**
 * What this archive used of paid services this month (lib/images.ts), and the threshold that raises an alert.
 * Administrators (`settings:manage`).
 */
import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import type { DamEnv } from '../env'
import { IMAGES_ALERT_KEY, imageUsage } from '../lib/images'
import { readJsonObject } from '../lib/http'
import { nowIso } from '../lib/time'

export const usageRoutes = new Hono<DamEnv>()

usageRoutes.use('*', requirePermission('settings:manage'))

usageRoutes.get('/', async (c) => c.json({ images: await imageUsage(c.env.DB) }))

/** `{ alertAt }`: alert when a month's image count reaches it; 0 turns the alert off. */
usageRoutes.put('/images', async (c) => {
  const body = await readJsonObject(c).catch(() => ({}) as Record<string, unknown>)
  const alertAt = body.alertAt
  if (typeof alertAt !== 'number' || !Number.isInteger(alertAt) || alertAt < 0 || alertAt > 10_000_000) {
    return c.json({ error: 'invalid_request', message: 'alertAt must be a whole number from 0 (off) to 10,000,000.' }, 400)
  }
  await c.env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(IMAGES_ALERT_KEY, String(alertAt), nowIso())
    .run()
  return c.json({ images: await imageUsage(c.env.DB) })
})
