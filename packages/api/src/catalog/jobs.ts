/**
 * Jobs (plans/PLAN-C-v2.md, phase C3): a piece of work for a client, such as a wedding, a portrait session or a
 * product shoot, with shoot dates, a place, a stage, and albums. Its galleries are its albums' galleries.
 * Administrators only (`clients:manage`), like clients.
 *
 * Stages move by hand, either way, and Proofing and Final edits can be skipped. Two moves happen by
 * themselves: Booked → Shot when photos taken on the shoot dates arrive (the sweep, sweepShot), and → Delivered
 * when a gallery of one of its albums is made with "Final delivery" ticked (markDelivered).
 */
import { randomId } from '../lib/crypto'
import { BadRequest, optionalString } from '../lib/http'
import { say } from '../lib/language'
import { nowIso } from '../lib/time'
import { buildWhere, type ListFilters } from './assets'
import { fold } from './client-records'

export const STAGES = ['booked', 'shot', 'editing', 'proofing', 'final_edits', 'delivered', 'completed', 'cancelled'] as const
export type Stage = (typeof STAGES)[number]
/** Stages a job may skip: portraits and product shoots often have no proofing. */
export const OPTIONAL_STAGES: readonly Stage[] = ['proofing', 'final_edits']
/** Work still to do. */
export const OPEN_STAGES: readonly Stage[] = ['booked', 'shot', 'editing', 'proofing', 'final_edits']
export const KINDS = ['wedding', 'portrait', 'family', 'event', 'commercial', 'editorial', 'other'] as const
export type Kind = (typeof KINDS)[number]
/** How many photos an album made from dates or a filter may hold. */
export const MAX_JOB_ALBUM = 10_000

const DAY = /^\d{4}-\d{2}-\d{2}$/
const isStage = (v: unknown): v is Stage => typeof v === 'string' && (STAGES as readonly string[]).includes(v)
const isKind = (v: unknown): v is Kind => typeof v === 'string' && (KINDS as readonly string[]).includes(v)
/** The day after a YYYY-MM-DD day, for half-open ranges over captured_at. */
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

interface JobRow {
  id: string
  client_id: string
  title: string
  client_title: string
  kind: string
  kind_other: string
  shoot_start: string | null
  shoot_end: string | null
  place: string
  stage: string
  stage_at: string
  due_on: string | null
  delivered_at: string | null
  notes: string
  created_at: string
  updated_at: string
}

export interface JobSummary {
  id: string
  title: string
  clientTitle: string
  client: { id: string; name: string }
  kind: Kind
  kindOther: string
  shootStart: string | null
  shootEnd: string | null
  place: string
  stage: Stage
  stageAt: string
  dueOn: string | null
  deliveredAt: string | null
  albums: number
  /** Galleries of its albums that are still open. */
  openGalleries: number
}

export interface JobJson extends JobSummary {
  notes: string
  createdAt: string
  updatedAt: string
}

const SUMMARY = `SELECT j.*, c.name AS client_name,
  (SELECT COUNT(*) FROM albums al WHERE al.job_id = j.id) AS albums,
  (SELECT COUNT(*) FROM albums al JOIN shares s ON s.album_id = al.id
     WHERE al.job_id = j.id AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?1)) AS open_galleries
  FROM jobs j JOIN clients c ON c.id = j.client_id`

type SummaryRow = JobRow & { client_name: string; albums: number; open_galleries: number }

const summaryJson = (r: SummaryRow): JobSummary => ({
  id: r.id,
  title: r.title,
  clientTitle: r.client_title,
  client: { id: r.client_id, name: r.client_name },
  kind: isKind(r.kind) ? r.kind : 'other',
  kindOther: r.kind_other,
  shootStart: r.shoot_start,
  shootEnd: r.shoot_end,
  place: r.place,
  stage: isStage(r.stage) ? r.stage : 'booked',
  stageAt: r.stage_at,
  dueOn: r.due_on,
  deliveredAt: r.delivered_at,
  albums: r.albums,
  openGalleries: r.open_galleries,
})

export interface JobInput {
  clientId?: string
  title?: string
  clientTitle?: string
  kind?: Kind
  kindOther?: string
  shootStart?: string | null
  shootEnd?: string | null
  place?: string
  dueOn?: string | null
  notes?: string
  stage?: Stage
}

function optionalDay(body: Record<string, unknown>, field: string): string | null | undefined {
  const value = body[field]
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequest(`${field} must be a day (YYYY-MM-DD).`)
  return value
}

/** Read and check a create or edit request. */
export function parseJobInput(body: Record<string, unknown>, creating: boolean): JobInput {
  const title = optionalString(body, 'title', 200)
  if ((creating || title !== undefined) && !title) throw new BadRequest(say('err.jobTitle'))
  const clientId = optionalString(body, 'clientId', 64)
  if (creating && !clientId) throw new BadRequest(say('err.jobClient'))
  if (body.kind !== undefined && !isKind(body.kind)) throw new BadRequest(`kind must be one of ${KINDS.join(', ')}.`)
  if (body.stage !== undefined && !isStage(body.stage)) throw new BadRequest(`stage must be one of ${STAGES.join(', ')}.`)
  const input: JobInput = {
    clientId,
    title,
    clientTitle: optionalString(body, 'clientTitle', 200),
    kind: body.kind as Kind | undefined,
    kindOther: optionalString(body, 'kindOther', 100),
    shootStart: optionalDay(body, 'shootStart'),
    shootEnd: optionalDay(body, 'shootEnd'),
    place: optionalString(body, 'place', 300),
    dueOn: optionalDay(body, 'dueOn'),
    notes: optionalString(body, 'notes', 10_000),
    stage: body.stage as Stage | undefined,
  }
  // One day: the end is the start. An end before the start is a mistake.
  if (input.shootStart && input.shootEnd && input.shootEnd < input.shootStart) throw new BadRequest(say('err.jobDates'))
  return input
}

export async function refreshJobSearch(db: D1Database, jobId: string): Promise<void> {
  const row = await db
    .prepare('SELECT j.title, j.client_title, j.place, c.name, c.company FROM jobs j JOIN clients c ON c.id = j.client_id WHERE j.id = ?')
    .bind(jobId)
    .first<{ title: string; client_title: string; place: string; name: string; company: string }>()
  if (!row) return
  const text = [row.title, row.client_title, row.place, row.name, row.company].filter(Boolean).join(' ')
  await db.prepare('UPDATE jobs SET search = ? WHERE id = ?').bind(fold(text), jobId).run()
}

/** Make a job. Returns null when the client doesn't exist. */
export async function createJob(db: D1Database, input: JobInput, actorId: string): Promise<string | null> {
  if (!(await db.prepare('SELECT 1 FROM clients WHERE id = ?').bind(input.clientId).first())) return null
  const id = randomId()
  const now = nowIso()
  const stage = input.stage ?? 'booked'
  await db
    .prepare(
      `INSERT INTO jobs (id, client_id, title, client_title, kind, kind_other, shoot_start, shoot_end, place, stage, stage_at, due_on, delivered_at, notes, created_by, created_at, updated_at, archive_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.clientId!,
      input.title!,
      input.clientTitle ?? '',
      input.kind ?? 'other',
      input.kindOther ?? '',
      input.shootStart ?? null,
      input.shootEnd ?? null,
      input.place ?? '',
      stage,
      now,
      input.dueOn ?? null,
      stage === 'delivered' || stage === 'completed' ? now : null,
      input.notes ?? '',
      actorId,
      now,
      now,
      stage === 'delivered' || stage === 'completed' ? now : null,
    )
    .run()
  await refreshJobSearch(db, id)
  return id
}

export async function getJob(db: D1Database, id: string): Promise<JobJson | null> {
  const row = await db.prepare(`${SUMMARY} WHERE j.id = ?2`).bind(nowIso(), id).first<SummaryRow>()
  if (!row) return null
  return { ...summaryJson(row), notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at }
}

/** Jobs, the soonest shoot first within open work, newest first for finished work. */
export async function listJobs(db: D1Database, options: { q?: string; clientId?: string; stages?: readonly Stage[] } = {}): Promise<JobSummary[]> {
  const words = fold(options.q ?? '').split(/\s+/).filter(Boolean).slice(0, 8)
  const where: string[] = []
  const binds: unknown[] = [nowIso()]
  if (options.clientId) {
    binds.push(options.clientId)
    where.push(`j.client_id = ?${binds.length}`)
  }
  if (options.stages) {
    binds.push(JSON.stringify(options.stages))
    where.push(`j.stage IN (SELECT value FROM json_each(?${binds.length}))`)
  }
  for (const w of words) {
    binds.push(`%${w.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
    where.push(`j.search LIKE ?${binds.length} ESCAPE '\\'`)
  }
  const { results } = await db
    .prepare(`${SUMMARY} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY j.shoot_start IS NULL, j.shoot_start DESC, j.created_at DESC LIMIT 1000`)
    .bind(...binds)
    .all<SummaryRow>()
  return results.map(summaryJson)
}

const COLUMNS: Partial<Record<keyof JobInput, string>> = {
  clientId: 'client_id',
  title: 'title',
  clientTitle: 'client_title',
  kind: 'kind',
  kindOther: 'kind_other',
  shootStart: 'shoot_start',
  shootEnd: 'shoot_end',
  place: 'place',
  dueOn: 'due_on',
  notes: 'notes',
}

/** Change the given fields (not the stage: setStage). Returns the fields sent, or null if there's no such job. */
export async function updateJob(db: D1Database, id: string, input: JobInput): Promise<string[] | null> {
  if (input.clientId && !(await db.prepare('SELECT 1 FROM clients WHERE id = ?').bind(input.clientId).first())) throw new BadRequest(say('err.noClient'))
  const fields = (Object.keys(COLUMNS) as (keyof JobInput)[]).filter((k) => input[k] !== undefined)
  const current = await db.prepare('SELECT shoot_start, shoot_end FROM jobs WHERE id = ?').bind(id).first<{ shoot_start: string | null; shoot_end: string | null }>()
  if (!current) return null
  const start = input.shootStart !== undefined ? input.shootStart : current.shoot_start
  const end = input.shootEnd !== undefined ? input.shootEnd : current.shoot_end
  if (start && end && end < start) throw new BadRequest(say('err.jobDates'))
  await db
    .prepare(`UPDATE jobs SET ${[...fields.map((f) => `${COLUMNS[f]} = ?`), 'updated_at = ?'].join(', ')} WHERE id = ?`)
    .bind(...fields.map((f) => input[f] ?? null), nowIso(), id)
    .run()
  await refreshJobSearch(db, id)
  return fields
}

/** Move a job to a stage. Returns where it was, or null if there's no such job. */
export async function setStage(db: D1Database, id: string, stage: Stage): Promise<{ from: Stage; title: string } | null> {
  const job = await db.prepare('SELECT stage, title FROM jobs WHERE id = ?').bind(id).first<{ stage: Stage; title: string }>()
  if (!job) return null
  if (job.stage === stage) return { from: job.stage, title: job.title }
  const now = nowIso()
  // The archive clock (archive-jobs.ts): starts when the job enters Delivered or Completed from an open stage, again
  // on each re-delivery; stops when it goes back to an open stage.
  const finished = stage === 'delivered' || stage === 'completed'
  const wasOpen = OPEN_STAGES.includes(job.stage)
  await db
    .prepare(
      `UPDATE jobs SET stage = ?, stage_at = ?, updated_at = ?,
         delivered_at = CASE WHEN ? IN ('delivered', 'completed') THEN COALESCE(delivered_at, ?) ELSE delivered_at END,
         archive_from = CASE WHEN ?7 = 1 AND ?8 = 1 THEN ?2 WHEN ?7 = 1 THEN archive_from ELSE NULL END,
         archive_state = CASE WHEN ?7 = 1 AND ?8 = 0 THEN archive_state ELSE NULL END
       WHERE id = ?6`,
    )
    .bind(stage, now, now, stage, now, id, finished ? 1 : 0, wasOpen ? 1 : 0)
    .run()
  return { from: job.stage, title: job.title }
}

/** Delete a job. Its albums and galleries stay, no longer part of a job. */
export async function deleteJob(db: D1Database, id: string): Promise<string | null> {
  const job = await db.prepare('SELECT title FROM jobs WHERE id = ?').bind(id).first<{ title: string }>()
  if (!job) return null
  await db.prepare('DELETE FROM jobs WHERE id = ?').bind(id).run()
  return job.title
}

export interface JobAlbumJson {
  id: string
  name: string
  photos: number
  galleries: number
  updatedAt: string
}

export async function jobAlbums(db: D1Database, jobId: string): Promise<JobAlbumJson[]> {
  const { results } = await db
    .prepare(
      `SELECT al.id, al.name, al.updated_at,
         (SELECT COUNT(*) FROM album_items ai JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL WHERE ai.album_id = al.id) AS photos,
         (SELECT COUNT(*) FROM shares s WHERE s.album_id = al.id AND s.revoked_at IS NULL) AS galleries
       FROM albums al WHERE al.job_id = ? ORDER BY al.created_at`,
    )
    .bind(jobId)
    .all<{ id: string; name: string; updated_at: string; photos: number; galleries: number }>()
  return results.map((r) => ({ id: r.id, name: r.name, photos: r.photos, galleries: r.galleries, updatedAt: r.updated_at }))
}

/** Albums not in any job, newest first, to add to one. */
export async function albumsWithoutJob(db: D1Database): Promise<{ id: string; name: string }[]> {
  const { results } = await db.prepare('SELECT id, name FROM albums WHERE job_id IS NULL ORDER BY updated_at DESC LIMIT 500').all<{ id: string; name: string }>()
  return results
}

/** Put an album in a job (moving it out of another). False if either doesn't exist. */
export async function linkAlbum(db: D1Database, jobId: string, albumId: string): Promise<boolean> {
  if (!(await db.prepare('SELECT 1 FROM jobs WHERE id = ?').bind(jobId).first())) return false
  const result = await db.prepare('UPDATE albums SET job_id = ?, updated_at = ? WHERE id = ?').bind(jobId, nowIso(), albumId).run()
  return result.meta.changes === 1
}

export async function unlinkAlbum(db: D1Database, jobId: string, albumId: string): Promise<boolean> {
  const result = await db.prepare('UPDATE albums SET job_id = NULL, updated_at = ? WHERE id = ? AND job_id = ?').bind(nowIso(), albumId, jobId).run()
  return result.meta.changes === 1
}

/** Filters a job's photos can be chosen by: not meaning or look-alikes, which are rankings, not sets. */
export function setFilter(filters: ListFilters): ListFilters {
  if (filters.near || filters.like || filters.meaning) throw new BadRequest(say('err.jobFilter'))
  return filters
}

/** How many photos a Library filter matches, and the days they were taken, for "New job from these photos". */
export async function filterSummary(db: D1Database, filters: ListFilters): Promise<{ photos: number; first: string | null; last: string | null }> {
  const { clause, params } = buildWhere(setFilter(filters))
  const row = await db
    .prepare(`SELECT COUNT(*) AS photos, MIN(substr(a.captured_at, 1, 10)) AS first, MAX(substr(a.captured_at, 1, 10)) AS last FROM assets a WHERE ${clause}`)
    .bind(...params)
    .first<{ photos: number; first: string | null; last: string | null }>()
  return row ?? { photos: 0, first: null, last: null }
}

/**
 * A new album in the job holding the photos that match a Library filter (or, with none, the photos taken on the
 * job's shoot dates), in the order they were taken. Built on the server, so it isn't limited to a selection.
 */
export async function albumForJob(db: D1Database, jobId: string, name: string, filters: ListFilters | null, actorId: string): Promise<{ albumId: string; photos: number } | null> {
  const job = await db.prepare('SELECT shoot_start, shoot_end FROM jobs WHERE id = ?').bind(jobId).first<{ shoot_start: string | null; shoot_end: string | null }>()
  if (!job) return null
  let where: { clause: string; params: unknown[] }
  if (filters) where = buildWhere(setFilter(filters))
  else {
    if (!job.shoot_start) throw new BadRequest(say('err.jobNoDates'))
    where = {
      clause: "a.deleted_at IS NULL AND a.status != 'uploading' AND a.captured_at >= ? AND a.captured_at < ?",
      params: [job.shoot_start, nextDay(job.shoot_end ?? job.shoot_start)],
    }
  }
  const albumId = randomId()
  const now = nowIso()
  await db.batch([
    db.prepare('INSERT INTO albums (id, name, description, created_by, created_at, updated_at, job_id) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(albumId, name, '', actorId, now, now, jobId),
    db
      .prepare(
        `INSERT INTO album_items (album_id, asset_id, position, added_at)
         SELECT ?, id, row_number() OVER (ORDER BY taken, id) - 1, ? FROM (
           SELECT a.id, COALESCE(a.captured_at, a.created_at) AS taken FROM assets a WHERE ${where.clause}
           ORDER BY taken, a.id LIMIT ${MAX_JOB_ALBUM})`,
      )
      .bind(albumId, now, ...where.params),
  ])
  const photos = (await db.prepare('SELECT COUNT(*) AS n FROM album_items WHERE album_id = ?').bind(albumId).first<{ n: number }>())!.n
  return { albumId, photos }
}

/**
 * A gallery of this album was made (or changed) with "Final delivery": its job, if still being worked on, moves
 * to Delivered. Returns the job moved, for the activity log.
 */
export async function markDelivered(db: D1Database, albumId: string): Promise<{ jobId: string; title: string; from: Stage } | null> {
  const job = await db
    .prepare(`SELECT j.id, j.title, j.stage FROM albums al JOIN jobs j ON j.id = al.job_id WHERE al.id = ? AND j.stage IN (SELECT value FROM json_each(?))`)
    .bind(albumId, JSON.stringify(OPEN_STAGES))
    .first<{ id: string; title: string; stage: Stage }>()
  if (!job) return null
  await setStage(db, job.id, 'delivered')
  return { jobId: job.id, title: job.title, from: job.stage }
}

/** Booked jobs whose shoot dates have photos now: moved to Shot. Returns them, for the activity log. */
export async function sweepShot(db: D1Database): Promise<{ id: string; title: string }[]> {
  const now = nowIso()
  const { results } = await db
    .prepare(
      `UPDATE jobs SET stage = 'shot', stage_at = ?1, updated_at = ?1
       WHERE stage = 'booked' AND shoot_start IS NOT NULL AND shoot_start <= substr(?1, 1, 10)
         AND EXISTS (SELECT 1 FROM assets a WHERE a.deleted_at IS NULL AND a.captured_at >= jobs.shoot_start
                     AND a.captured_at < date(COALESCE(jobs.shoot_end, jobs.shoot_start), '+1 day'))
       RETURNING id, title`,
    )
    .bind(now)
    .all<{ id: string; title: string }>()
  return results
}

export type AttentionKind = 'overdue' | 'dueSoon' | 'noPhotos' | 'expiring' | 'noPicks'

export interface AttentionJson {
  kind: AttentionKind
  job: { id: string; title: string; clientName: string }
  /** The due day, the shoot day, or when the gallery closes or was made. */
  date: string
  gallery?: { id: string; name: string }
}

/**
 * What needs a person, most urgent first: promised delivery passed or within 7 days; a shoot more than 3 days
 * ago with no photos yet; a job's gallery closing within 7 days; a proofing gallery with no favourites after
 * 14 days.
 */
export async function needsAttention(db: D1Database, today = nowIso().slice(0, 10)): Promise<AttentionJson[]> {
  const now = nowIso()
  const week = new Date(Date.now() + 7 * 86_400_000)
  const open = JSON.stringify(OPEN_STAGES)
  const [due, noPhotos, expiring, noPicks] = await db.batch([
    db
      .prepare(`SELECT j.id, j.title, c.name AS client_name, j.due_on AS date FROM jobs j JOIN clients c ON c.id = j.client_id
                WHERE j.due_on IS NOT NULL AND j.due_on <= ? AND j.stage IN (SELECT value FROM json_each(?)) ORDER BY j.due_on`)
      .bind(week.toISOString().slice(0, 10), open),
    db
      .prepare(`SELECT j.id, j.title, c.name AS client_name, j.shoot_start AS date FROM jobs j JOIN clients c ON c.id = j.client_id
                WHERE j.stage = 'booked' AND j.shoot_start IS NOT NULL AND date(COALESCE(j.shoot_end, j.shoot_start), '+3 days') < ? ORDER BY j.shoot_start`)
      .bind(today),
    db
      .prepare(`SELECT j.id, j.title, c.name AS client_name, s.expires_at AS date, s.id AS share_id, s.name AS share_name
                FROM shares s JOIN albums al ON al.id = s.album_id JOIN jobs j ON j.id = al.job_id JOIN clients c ON c.id = j.client_id
                WHERE s.revoked_at IS NULL AND s.expires_at > ? AND s.expires_at <= ? ORDER BY s.expires_at`)
      .bind(now, week.toISOString()),
    db
      .prepare(`SELECT j.id, j.title, c.name AS client_name, s.created_at AS date, s.id AS share_id, s.name AS share_name
                FROM shares s JOIN albums al ON al.id = s.album_id JOIN jobs j ON j.id = al.job_id JOIN clients c ON c.id = j.client_id
                WHERE j.stage = 'proofing' AND s.proofing = 1 AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)
                  AND s.created_at <= ? AND NOT EXISTS (SELECT 1 FROM share_picks p WHERE p.share_id = s.id) ORDER BY s.created_at`)
      .bind(now, new Date(Date.now() - 14 * 86_400_000).toISOString()),
  ])
  type Row = { id: string; title: string; client_name: string; date: string; share_id?: string; share_name?: string }
  const items = (rows: Row[], kind: (r: Row) => AttentionKind): AttentionJson[] =>
    rows.map((r) => ({
      kind: kind(r),
      job: { id: r.id, title: r.title, clientName: r.client_name },
      date: r.date,
      ...(r.share_id ? { gallery: { id: r.share_id, name: r.share_name ?? '' } } : {}),
    }))
  return [
    ...items(due!.results as Row[], (r) => (r.date < today ? 'overdue' : 'dueSoon')),
    ...items(noPhotos!.results as Row[], () => 'noPhotos'),
    ...items(expiring!.results as Row[], () => 'expiring'),
    ...items(noPicks!.results as Row[], () => 'noPicks'),
  ]
}
