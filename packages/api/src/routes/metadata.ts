import { Hono, type Context } from 'hono'
import { requirePermission } from '../auth/principal'
import { buildWhere, parseListFilters, type ListFilters } from '../catalog/assets'
import { getPreset, IPTC_FIELDS, listPresets, parseIptcPatch, savePreset } from '../catalog/iptc'
import type { DamEnv } from '../env'
import { randomId } from '../lib/crypto'
import { BadRequest, readJsonObject, requiredString } from '../lib/http'
import { nowIso } from '../lib/time'

function failure(c: Context<DamEnv>, error: unknown) {
  if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
  throw error
}

function presetInput(body: Record<string, unknown>) {
  if (typeof body.fields !== 'object' || body.fields === null || Array.isArray(body.fields)) throw new BadRequest('fields must be an object.')
  let fields
  try {
    fields = parseIptcPatch(body.fields as Record<string, unknown>)
  } catch (error) {
    throw new BadRequest(error instanceof Error ? error.message : 'Invalid fields.')
  }
  if (!Object.values(fields).some((v) => v)) throw new BadRequest('A preset needs at least one field.')
  return { name: requiredString(body, 'name', 100), fields, applyToUploads: body.applyToUploads === true }
}

// ── Metadata presets ────────────────────────────────────────────────────────

export const presetRoutes = new Hono<DamEnv>()

presetRoutes.get('/', requirePermission('assets:read'), async (c) => c.json({ presets: await listPresets(c.env.DB), fields: IPTC_FIELDS }))

presetRoutes.post('/', requirePermission('assets:edit'), async (c) => {
  try {
    const preset = await savePreset(c.env.DB, { ...presetInput(await readJsonObject(c)), userId: c.get('principal')!.userId })
    return c.json({ preset }, 201)
  } catch (error) {
    return failure(c, error)
  }
})

presetRoutes.put('/:id', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  if (!(await getPreset(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  try {
    const preset = await savePreset(c.env.DB, { id, ...presetInput(await readJsonObject(c)), userId: c.get('principal')!.userId })
    return c.json({ preset })
  } catch (error) {
    return failure(c, error)
  }
})

presetRoutes.delete('/:id', requirePermission('assets:edit'), async (c) => {
  await c.env.DB.prepare('DELETE FROM metadata_presets WHERE id = ?').bind(c.req.param('id')).run()
  return c.body(null, 204)
})

// ── Saved searches (smart albums) ───────────────────────────────────────────

export const savedSearchRoutes = new Hono<DamEnv>()

const KEEP: (keyof ListFilters)[] = ['q', 'tag', 'camera', 'lens', 'albumId', 'from', 'to', 'year', 'month', 'rating', 'flag', 'label', 'country', 'city', 'creator', 'gps', 'storedOn', 'missing', 'orientation', 'type', 'tier', 'sort']
const PARAM: Partial<Record<keyof ListFilters, string>> = { albumId: 'album', storedOn: 'on' }

/** Keep only filters the library understands, in a stable order, so a saved search is a clean URL. */
export function normalizeQuery(query: string): string {
  const filters = parseListFilters(Object.fromEntries(new URLSearchParams(query.replace(/^\?/, ''))))
  const out = new URLSearchParams()
  for (const key of KEEP) {
    const value = filters[key]
    if (value === undefined || value === '' || (key === 'sort' && value === 'captured')) continue
    out.set(PARAM[key] ?? key, value === true ? '1' : String(value))
  }
  return out.toString()
}

interface SavedSearchRow {
  id: string
  name: string
  query: string
  position: number
}

export interface SavedSearch extends SavedSearchRow {
  count: number
}

/** Saved searches with live counts: one small COUNT each, in one round trip. */
export async function listSavedSearches(db: D1Database): Promise<SavedSearch[]> {
  const { results } = await db.prepare('SELECT id, name, query, position FROM saved_searches ORDER BY position, name LIMIT 100').all<SavedSearchRow>()
  const counts = results.length
    ? await db.batch(
        results.map((s) => {
          const { clause, params } = buildWhere(parseListFilters(Object.fromEntries(new URLSearchParams(s.query))))
          return db.prepare(`SELECT COUNT(*) AS n FROM assets a WHERE ${clause}`).bind(...params)
        }),
      )
    : []
  return results.map((s, i) => ({ ...s, count: (counts[i]?.results?.[0] as { n: number } | undefined)?.n ?? 0 }))
}

savedSearchRoutes.get('/', requirePermission('assets:read'), async (c) => c.json({ searches: await listSavedSearches(c.env.DB) }))

savedSearchRoutes.post('/', requirePermission('assets:edit'), async (c) => {
  try {
    const body = await readJsonObject(c)
    const name = requiredString(body, 'name', 100)
    const query = normalizeQuery(typeof body.query === 'string' ? body.query : '')
    if (!query || query === 'sort=added') throw new BadRequest('Choose some filters before saving a search.')
    const id = randomId()
    const position = (await c.env.DB.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM saved_searches').first<{ next: number }>())?.next ?? 0
    await c.env.DB.prepare('INSERT INTO saved_searches (id, name, query, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, name, query, position, c.get('principal')!.userId, nowIso())
      .run()
    return c.json({ search: { id, name, query, position } }, 201)
  } catch (error) {
    return failure(c, error)
  }
})

savedSearchRoutes.patch('/:id', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    const sets: string[] = []
    const params: unknown[] = []
    if (body.name !== undefined) {
      sets.push('name = ?')
      params.push(requiredString(body, 'name', 100))
    }
    if (body.query !== undefined) {
      const query = normalizeQuery(typeof body.query === 'string' ? body.query : '')
      if (!query) throw new BadRequest('Choose some filters.')
      sets.push('query = ?')
      params.push(query)
    }
    if (body.position !== undefined) {
      if (!Number.isInteger(body.position)) throw new BadRequest('position must be a whole number.')
      sets.push('position = ?')
      params.push(body.position)
    }
    if (sets.length === 0) throw new BadRequest('Nothing to change.')
    const result = await c.env.DB.prepare(`UPDATE saved_searches SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run()
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404)
    return c.json({ ok: true })
  } catch (error) {
    return failure(c, error)
  }
})

savedSearchRoutes.delete('/:id', requirePermission('assets:edit'), async (c) => {
  await c.env.DB.prepare('DELETE FROM saved_searches WHERE id = ?').bind(c.req.param('id')).run()
  return c.body(null, 204)
})
