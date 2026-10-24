/**
 * Jobs (catalog/jobs.ts): work for a client with shoot dates, a stage and albums. Administrators only
 * (`clients:manage`), like clients.
 */
import { Hono, type Context } from 'hono'
import { requirePermission } from '../auth/principal'
import { parseListFilters } from '../catalog/assets'
import { createClient, parseClientInput } from '../catalog/client-records'
import {
  albumForJob,
  albumsWithoutJob,
  createJob,
  deleteJob,
  filterSummary,
  getJob,
  jobAlbums,
  linkAlbum,
  listJobs,
  needsAttention,
  OPEN_STAGES,
  parseJobInput,
  setStage,
  STAGES,
  unlinkAlbum,
  updateJob,
  type Stage,
} from '../catalog/jobs'
import { ARCHIVE_JOB_CLASSES, getArchiveJobSettings, jobArchiveStatus, queueJobArchive, setKeepHot, type ArchiveJobClass } from '../catalog/archive-jobs'
import { JOB_RESTORE_TIERS, jobRestoreStatus, jobStorage, restoreEstimate, startJobRestore, type JobRestoreTier } from '../catalog/job-storage'
import { jobShares } from '../catalog/shares'
import { nudge } from '../catalog/work'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, optionalString, readJsonObject } from '../lib/http'
import { say } from '../lib/language'

export const jobRoutes = new Hono<DamEnv>()

jobRoutes.use('*', requirePermission('clients:manage'))

const invalid = (error: unknown) => {
  if (error instanceof BadRequest) return { error: 'invalid_request', message: error.message }
  throw error
}
const notFound = () => ({ error: 'not_found', message: say('err.noJob') })
const log = (c: Context<DamEnv>, action: string, jobId: string, details: Record<string, unknown>) =>
  logActivity(c.env.DB, { userId: c.get('principal')!.userId, action, targetType: 'job', targetId: jobId, details, ipAddress: c.req.header('cf-connecting-ip') })

/** A Library filter, as the Library's own query string ("year=2024&kw=…"). */
const filtersFrom = (query: unknown) => {
  if (typeof query !== 'string' || query.length > 2000) throw new BadRequest('query must be the Library\'s query string.')
  return parseListFilters(Object.fromEntries(new URLSearchParams(query)))
}

/** `?stages=open` (the default), `done`, or `all`; `?q=` and `?client=` narrow it. */
jobRoutes.get('/', async (c) => {
  const which = c.req.query('stages') ?? 'open'
  const stages: readonly Stage[] | undefined = which === 'all' ? undefined : which === 'done' ? STAGES.filter((s) => !OPEN_STAGES.includes(s)) : OPEN_STAGES
  return c.json({ jobs: await listJobs(c.env.DB, { q: c.req.query('q'), clientId: c.req.query('client') || undefined, stages }) })
})

jobRoutes.get('/attention', async (c) => c.json({ items: await needsAttention(c.env.DB) }))

/** How many photos a Library filter matches, and on which days, for "New job from these photos". */
jobRoutes.get('/photos', async (c) => {
  try {
    return c.json(await filterSummary(c.env.DB, filtersFrom(c.req.query('query') ?? '')))
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

jobRoutes.get('/free-albums', async (c) => c.json({ albums: await albumsWithoutJob(c.env.DB) }))

/**
 * Make a job. `clientId`, or `newClient: { name }` to make the client too. `photos: 'dates'` makes an album of
 * the photos taken on the shoot dates; `photos: { query }` one of the photos a Library filter matches.
 */
jobRoutes.post('/', async (c) => {
  const principal = c.get('principal')!
  try {
    const body = await readJsonObject(c)
    if (body.newClient && typeof body.newClient === 'object' && !body.clientId) {
      const clientInput = parseClientInput(body.newClient as Record<string, unknown>, true)
      body.clientId = await createClient(c.env.DB, clientInput, principal.userId)
      await logActivity(c.env.DB, { userId: principal.userId, action: 'client.created', targetType: 'client', targetId: body.clientId as string, details: { name: clientInput.name }, ipAddress: c.req.header('cf-connecting-ip') })
    }
    const input = parseJobInput(body, true)
    const filters = body.photos && typeof body.photos === 'object' ? filtersFrom((body.photos as Record<string, unknown>).query) : null
    const id = await createJob(c.env.DB, input, principal.userId)
    if (!id) return c.json({ error: 'not_found', message: say('err.noClient') }, 404)
    await log(c, 'job.created', id, { title: input.title, clientId: input.clientId })
    let album: { albumId: string; photos: number } | null = null
    if (filters || body.photos === 'dates') album = await albumForJob(c.env.DB, id, input.title!, filters, principal.userId)
    return c.json({ job: await getJob(c.env.DB, id), album }, 201)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

jobRoutes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const job = await getJob(c.env.DB, id)
  if (!job) return c.json(notFound(), 404)
  const [albums, galleries] = await Promise.all([jobAlbums(c.env.DB, id), jobShares(c.env.DB, id)])
  return c.json({ job, albums, galleries })
})

jobRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const input = parseJobInput(await readJsonObject(c), false)
    delete input.stage // stages move through /stage, so each move is logged
    const fields = await updateJob(c.env.DB, id, input)
    if (!fields) return c.json(notFound(), 404)
    const job = (await getJob(c.env.DB, id))!
    if (fields.length > 0) await log(c, 'job.updated', id, { title: job.title, fields })
    return c.json({ job })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

/** Move to any stage, forward or back; Proofing and Final edits may be skipped. */
jobRoutes.post('/:id/stage', async (c) => {
  const id = c.req.param('id')
  const body = await readJsonObject(c).catch(() => ({}) as Record<string, unknown>)
  const stage = body.stage as Stage
  if (!STAGES.includes(stage)) return c.json({ error: 'invalid_request', message: `stage must be one of ${STAGES.join(', ')}.` }, 400)
  const moved = await setStage(c.env.DB, id, stage)
  if (!moved) return c.json(notFound(), 404)
  if (moved.from !== stage) await log(c, 'job.stage', id, { title: moved.title, from: moved.from, to: stage })
  return c.json({ job: await getJob(c.env.DB, id) })
})

/** Delete the job; its albums and galleries stay. */
jobRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const title = await deleteJob(c.env.DB, id)
  if (title === null) return c.json(notFound(), 404)
  await log(c, 'job.deleted', id, { title })
  return c.body(null, 204)
})

/**
 * Add an album: `{ albumId }` puts an existing one in the job; `{ photos: 'dates' }` or `{ photos: { query } }`
 * makes a new one (named `name`, or the job's title) from the shoot dates or a Library filter.
 */
jobRoutes.post('/:id/albums', async (c) => {
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    const job = await getJob(c.env.DB, id)
    if (!job) return c.json(notFound(), 404)
    if (typeof body.albumId === 'string') {
      if (!(await linkAlbum(c.env.DB, id, body.albumId))) return c.json({ error: 'not_found', message: say('err.noAlbum') }, 404)
      await log(c, 'job.album_added', id, { title: job.title, albumId: body.albumId })
      return c.json({ albums: await jobAlbums(c.env.DB, id) }, 201)
    }
    const filters = body.photos && typeof body.photos === 'object' ? filtersFrom((body.photos as Record<string, unknown>).query) : null
    if (!filters && body.photos !== 'dates') throw new BadRequest('Send albumId, or photos: "dates" or { query }.')
    const name = optionalString(body, 'name', 200) || job.title
    const album = (await albumForJob(c.env.DB, id, name, filters, c.get('principal')!.userId))!
    await log(c, 'job.album_added', id, { title: job.title, albumId: album.albumId })
    return c.json({ albums: await jobAlbums(c.env.DB, id), album }, 201)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

/** Where the job's originals are, and its latest restore. */
jobRoutes.get('/:id/storage', async (c) => {
  const id = c.req.param('id')
  if (!(await getJob(c.env.DB, id))) return c.json(notFound(), 404)
  const [storage, restore] = await Promise.all([jobStorage(c.env.DB, [id]), jobRestoreStatus(c.env.DB, id)])
  return c.json({ storage: storage.get(id), restore })
})

function restoreChoice(tier: unknown, days: unknown): { tier: JobRestoreTier; days: number } {
  const t = (tier ?? 'Bulk') as JobRestoreTier
  const d = Number(days ?? 7)
  if (!JOB_RESTORE_TIERS.includes(t)) throw new BadRequest(`tier is one of ${JOB_RESTORE_TIERS.join(', ')}.`)
  if (!Number.isInteger(d) || d < 1 || d > 30) throw new BadRequest('days is 1 to 30.')
  return { tier: t, days: d }
}

/** What restoring the job would cost and take: `?tier=Bulk|Standard&days=7`. */
jobRoutes.get('/:id/restore-estimate', async (c) => {
  try {
    const { tier, days } = restoreChoice(c.req.query('tier'), c.req.query('days'))
    return c.json({ estimate: await restoreEstimate(c.env.DB, c.req.param('id'), tier, days) })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

/** Restore every photo of the job that needs it (also needs `lifecycle:manage`). */
jobRoutes.post('/:id/restore', async (c) => {
  const principal = c.get('principal')!
  if (!principal.permissions.has('lifecycle:manage')) return c.json({ error: 'forbidden', message: say('err.cantRestore') }, 403)
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    const { tier, days } = restoreChoice(body.tier, body.days)
    const job = await getJob(c.env.DB, id)
    if (!job) return c.json(notFound(), 404)
    const started = await startJobRestore(c.env.DB, id, tier, days, principal.userId)
    if (!started) return c.json({ error: 'nothing_to_restore', message: say('err.nothingToRestore') }, 409)
    await nudge(c.env, 'restore', started.photos)
    await log(c, 'job.restore', id, { title: job.title, photos: started.photos, tier, days })
    return c.json({ restore: await jobRestoreStatus(c.env.DB, id) }, 202)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

/** Where the job's archive stands (archive-jobs.ts). */
jobRoutes.get('/:id/archive', async (c) => {
  const status = await jobArchiveStatus(c.env.DB, c.req.param('id'))
  return status ? c.json({ archive: status }) : c.json(notFound(), 404)
})

/** `{ keepHot }`: never archive this job automatically (reprints, albums in progress). */
jobRoutes.post('/:id/keep-hot', async (c) => {
  const id = c.req.param('id')
  const body = await readJsonObject(c).catch(() => ({}) as Record<string, unknown>)
  if (typeof body.keepHot !== 'boolean') return c.json({ error: 'invalid_request', message: 'keepHot must be true or false.' }, 400)
  if (!(await setKeepHot(c.env.DB, id, body.keepHot))) return c.json(notFound(), 404)
  return c.json({ archive: await jobArchiveStatus(c.env.DB, id) })
})

/**
 * Archive the job now, without waiting for its day (also needs `sources:manage`): `{ storageClass }` may choose
 * another cold class than the settings' for this job.
 */
jobRoutes.post('/:id/archive-now', async (c) => {
  const principal = c.get('principal')!
  if (!principal.permissions.has('sources:manage')) return c.json({ error: 'forbidden', message: say('err.cantArchive') }, 403)
  const id = c.req.param('id')
  const job = await getJob(c.env.DB, id)
  if (!job) return c.json(notFound(), 404)
  const body = await readJsonObject(c).catch(() => ({}) as Record<string, unknown>)
  const settings = await getArchiveJobSettings(c.env.DB)
  if (!settings.connectionId) return c.json({ error: 'not_set_up', message: say('err.archiveNotSetUp') }, 409)
  const storageClass = (body.storageClass ?? settings.storageClass) as ArchiveJobClass
  if (!ARCHIVE_JOB_CLASSES.includes(storageClass)) return c.json({ error: 'invalid_request', message: `storageClass is one of ${ARCHIVE_JOB_CLASSES.join(', ')}.` }, 400)
  await c.env.DB.prepare('UPDATE jobs SET archive_state = NULL WHERE id = ?').bind(id).run()
  const note = await queueJobArchive(c.env.DB, id, settings, storageClass)
  await nudge(c.env, 'archive', note.copy + note.move)
  await log(c, 'job.archive_now', id, { title: job.title, storageClass, ...note })
  return c.json({ archive: await jobArchiveStatus(c.env.DB, id) }, 202)
})

/** Take an album out of the job. The album and its galleries stay. */
jobRoutes.delete('/:id/albums/:albumId', async (c) => {
  const { id, albumId } = c.req.param()
  if (!(await unlinkAlbum(c.env.DB, id, albumId))) return c.json(notFound(), 404)
  return c.body(null, 204)
})
