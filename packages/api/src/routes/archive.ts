/**
 * Archiving delivered jobs (catalog/archive-jobs.ts): the settings, and what they'd archive before saving them.
 * `sources:manage`, like the agent archive's settings.
 */
import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import { ArchiveSettingsError, getArchiveJobSettings, previewArchive, saveArchiveJobSettings, validArchiveJobSettings } from '../catalog/archive-jobs'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { readJsonObject } from '../lib/http'

export const archiveRoutes = new Hono<DamEnv>()

archiveRoutes.use('*', requirePermission('sources:manage'))

archiveRoutes.get('/jobs', async (c) => {
  const settings = await getArchiveJobSettings(c.env.DB)
  return c.json({ settings, preview: await previewArchive(c.env.DB, settings) })
})

/** What these settings would archive at once, without saving them. */
archiveRoutes.post('/jobs/preview', async (c) => {
  try {
    const settings = await validArchiveJobSettings(c.env.DB, await readJsonObject(c))
    return c.json({ settings, preview: await previewArchive(c.env.DB, settings) })
  } catch (error) {
    if (error instanceof ArchiveSettingsError) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

archiveRoutes.put('/jobs', async (c) => {
  try {
    const settings = await validArchiveJobSettings(c.env.DB, await readJsonObject(c))
    await saveArchiveJobSettings(c.env.DB, settings)
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'archive.settings_changed', details: { ...settings }, ipAddress: c.req.header('cf-connecting-ip') })
    return c.json({ settings, preview: await previewArchive(c.env.DB, settings) })
  } catch (error) {
    if (error instanceof ArchiveSettingsError) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})
