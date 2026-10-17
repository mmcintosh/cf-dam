import { Hono, type Context } from 'hono'
import { requirePermission } from '../auth/principal'
import { LABELS } from '../catalog/assets'
import {
  deleteKeyword,
  ensurePath,
  getKeyword,
  keywordJson,
  KeywordConflict,
  keywordTree,
  mergeKeyword,
  moveKeyword,
  splitPath,
  updateKeywordOptions,
} from '../catalog/keywords'
import { getLabelNames, saveLabelNames, type LabelNames } from '../catalog/library'
import { indexAsset } from '../catalog/search'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject, stringArray } from '../lib/http'

export const tagRoutes = new Hono<DamEnv>()

/** Reindex the photos a keyword change touched: the first few now, the rest by the sweep's index repair. */
const INLINE_REINDEX = 300
async function reindex(db: D1Database, assetIds: string[]): Promise<void> {
  for (const id of assetIds.slice(0, INLINE_REINDEX)) await indexAsset(db, id)
  const rest = assetIds.slice(INLINE_REINDEX)
  for (let i = 0; i < rest.length; i += 90) {
    const slice = rest.slice(i, i + 90)
    await db.prepare(`DELETE FROM assets_fts WHERE asset_id IN (${slice.map(() => '?').join(',')})`).bind(...slice).run()
  }
}

function failure(c: Context<DamEnv>, error: unknown) {
  if (error instanceof KeywordConflict) return c.json({ error: 'conflict', message: error.message }, 409)
  if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
  throw error
}

/** The keyword tree with counts. `?q=` narrows it to keywords whose name or path matches (for autocomplete). */
tagRoutes.get('/', requirePermission('assets:read'), async (c) => {
  const tree = await keywordTree(c.env.DB)
  const q = c.req.query('q')?.trim().toLowerCase()
  if (!q) return c.json({ keywords: tree })
  const matches = tree
    .filter((k) => k.path.toLowerCase().includes(q) || k.synonyms.some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || b.total - a.total)
    .slice(0, 20)
  return c.json({ keywords: matches })
})

/** Create a keyword from a path: `Places > Norway > Oslo`. */
tagRoutes.post('/', requirePermission('assets:edit'), async (c) => {
  try {
    const body = await readJsonObject(c)
    const names = typeof body.path === 'string' ? splitPath(body.path) : []
    if (names.length === 0) throw new BadRequest('path is required.')
    const id = await ensurePath(c.env.DB, names)
    return c.json({ keyword: keywordJson((await getKeyword(c.env.DB, id))!) }, 201)
  } catch (error) {
    return failure(c, error)
  }
})

/** Rename, move, or change export options and synonyms. */
tagRoutes.patch('/:id', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    if (!(await getKeyword(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
    const affected = new Set<string>()
    if (body.name !== undefined || body.parentId !== undefined) {
      if (body.name !== undefined && typeof body.name !== 'string') throw new BadRequest('name must be text.')
      if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== 'string') throw new BadRequest('parentId must be an id or null.')
      for (const a of await moveKeyword(c.env.DB, id, { name: body.name as string | undefined, parentId: body.parentId as string | null | undefined })) affected.add(a)
    }
    const flag = (key: string) => {
      if (body[key] === undefined) return undefined
      if (typeof body[key] !== 'boolean') throw new BadRequest(`${key} must be true or false.`)
      return body[key] as boolean
    }
    const options = {
      includeOnExport: flag('includeOnExport'),
      exportParents: flag('exportParents'),
      exportSynonyms: flag('exportSynonyms'),
      synonyms: stringArray(body, 'synonyms'),
    }
    for (const a of await updateKeywordOptions(c.env.DB, id, options)) affected.add(a)
    await reindex(c.env.DB, [...affected])
    return c.json({ keyword: keywordJson((await getKeyword(c.env.DB, id))!), photos: affected.size })
  } catch (error) {
    return failure(c, error)
  }
})

/** Merge this keyword into another: its photos and children move there, and it goes. */
tagRoutes.post('/:id/merge', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    if (typeof body.into !== 'string') throw new BadRequest('into is required.')
    const affected = await mergeKeyword(c.env.DB, id, body.into)
    await reindex(c.env.DB, affected)
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'keyword.merged', targetType: 'keyword', targetId: id, details: { into: body.into, photos: affected.length } })
    return c.json({ keyword: keywordJson((await getKeyword(c.env.DB, body.into))!), photos: affected.length })
  } catch (error) {
    return failure(c, error)
  }
})

/** Delete a keyword and everything below it. Photos keep everything else. */
tagRoutes.delete('/:id', requirePermission('assets:edit'), async (c) => {
  const id = c.req.param('id')
  const row = await getKeyword(c.env.DB, id)
  if (!row) return c.json({ error: 'not_found' }, 404)
  const affected = await deleteKeyword(c.env.DB, id)
  await reindex(c.env.DB, affected)
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'keyword.deleted', targetType: 'keyword', targetId: id, details: { path: row.full_path, photos: affected.length } })
  return c.json({ photos: affected.length })
})

export const labelRoutes = new Hono<DamEnv>()

labelRoutes.get('/', requirePermission('assets:read'), async (c) => c.json({ labels: LABELS, names: await getLabelNames(c.env.DB) }))

labelRoutes.put('/', requirePermission('settings:manage'), async (c) => {
  try {
    const body = await readJsonObject(c)
    const patch: Partial<LabelNames> = {}
    for (const label of LABELS) {
      const value = body[label]
      if (value === undefined) continue
      if (typeof value !== 'string' || value.trim() === '' || value.length > 40) throw new BadRequest(`${label} must be a name up to 40 characters.`)
      patch[label] = value
    }
    return c.json({ labels: LABELS, names: await saveLabelNames(c.env.DB, patch) })
  } catch (error) {
    return failure(c, error)
  }
})
