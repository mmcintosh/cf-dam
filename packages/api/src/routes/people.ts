/**
 * People named in photos (catalog/people.ts). Seeing them needs `assets:read`; naming, renaming, merging and deleting
 * `people:manage`. Activity records what happened, never who: it outlives a deleted person.
 */
import { Hono, type Context } from 'hono'
import { requirePermission } from '../auth/principal'
import { assetPeople, deletePerson, getPerson, listPeople, mergePeople, parsePersonPatch, personByName, updatePerson } from '../catalog/people'
import { allGroups, createGroup, deleteGroup, groupCandidates, listGroups, parseGroupInput, updateGroup } from '../catalog/gallery-people'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject } from '../lib/http'
import { say } from '../lib/language'

export const peopleRoutes = new Hono<DamEnv>()

peopleRoutes.use('*', requirePermission('assets:read'))

const idOf = (value: string | undefined) => (value && /^\d{1,12}$/.test(value) ? Number(value) : null)
const invalid = (error: unknown) => {
  if (error instanceof BadRequest) return { error: 'invalid_request', message: error.message }
  throw error
}

peopleRoutes.get('/', async (c) => c.json({ people: await listPeople(c.env.DB, c.req.query('q') ?? '') }))

/** The people tagged on one photo. */
peopleRoutes.get('/photo/:assetId', async (c) => c.json({ people: await assetPeople(c.env.DB, c.req.param('assetId')) }))

peopleRoutes.post('/', requirePermission('people:manage'), async (c) => {
  try {
    const body = await readJsonObject(c)
    const principal = c.get('principal')!
    const { id, created } = await personByName(c.env.DB, typeof body.name === 'string' ? body.name : '', principal.userId)
    if (created) await logActivity(c.env.DB, { userId: principal.userId, action: 'person.created', targetType: 'person', targetId: String(id), ipAddress: c.req.header('cf-connecting-ip') })
    return c.json({ person: await getPerson(c.env.DB, id), created }, created ? 201 : 200)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

// ---- Groups (catalog/gallery-people.ts): before /:id. A group's name says how people are related, so reading
// groups needs people:manage too. Activity says a group changed, never its name or who is in it.

const groupFail = (c: Context<DamEnv>, outcome: 'taken' | null) =>
  outcome === 'taken' ? c.json({ error: 'name_taken', message: say('err.groupTaken') }, 409) : c.json({ error: 'not_found' }, 404)
const logGroup = (c: Context<DamEnv>, action: string, id: number) =>
  logActivity(c.env.DB, { userId: c.get('principal')!.userId, action, targetType: 'people_group', targetId: String(id), ipAddress: c.req.header('cf-connecting-ip') })

/** A client's groups (`?client=`), or every group for the Library's filter. */
peopleRoutes.get('/groups', requirePermission('people:manage'), async (c) => {
  const client = c.req.query('client')
  return client ? c.json({ groups: await listGroups(c.env.DB, client) }) : c.json({ groups: await allGroups(c.env.DB) })
})

/** Who a client's groups are usually made from: people on their jobs' photos, and people linked to them. */
peopleRoutes.get('/groups/candidates', requirePermission('people:manage'), async (c) => c.json({ people: await groupCandidates(c.env.DB, c.req.query('client') ?? '') }))

peopleRoutes.post('/groups', requirePermission('people:manage'), async (c) => {
  try {
    const body = await readJsonObject(c)
    const outcome = await createGroup(c.env.DB, typeof body.clientId === 'string' ? body.clientId : '', parseGroupInput(body, true), c.get('principal')!.userId)
    if (outcome === null || outcome === 'taken') return groupFail(c, outcome)
    await logGroup(c, 'people_group.created', outcome.id)
    return c.json({ group: outcome }, 201)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

peopleRoutes.patch('/groups/:groupId', requirePermission('people:manage'), async (c) => {
  const id = idOf(c.req.param('groupId'))
  if (id === null) return c.json({ error: 'not_found' }, 404)
  try {
    const outcome = await updateGroup(c.env.DB, id, parseGroupInput(await readJsonObject(c), false))
    if (outcome === null || outcome === 'taken') return groupFail(c, outcome)
    await logGroup(c, 'people_group.changed', id)
    return c.json({ group: outcome })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

peopleRoutes.delete('/groups/:groupId', requirePermission('people:manage'), async (c) => {
  const id = idOf(c.req.param('groupId'))
  if (id === null || !(await deleteGroup(c.env.DB, id))) return c.json({ error: 'not_found' }, 404)
  await logGroup(c, 'people_group.deleted', id)
  return c.body(null, 204)
})

peopleRoutes.get('/:id', async (c) => {
  const id = idOf(c.req.param('id'))
  const person = id === null ? null : await getPerson(c.env.DB, id)
  return person ? c.json({ person }) : c.json({ error: 'not_found' }, 404)
})

peopleRoutes.patch('/:id', requirePermission('people:manage'), async (c) => {
  const id = idOf(c.req.param('id'))
  if (id === null) return c.json({ error: 'not_found' }, 404)
  try {
    const patch = parsePersonPatch(await readJsonObject(c))
    const outcome = await updatePerson(c.env.DB, id, patch)
    if (outcome === null) return c.json({ error: 'not_found' }, 404)
    if (outcome === 'taken') return c.json({ error: 'name_taken', message: 'Someone already has that name: merge them instead.' }, 409)
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'person.changed', targetType: 'person', targetId: String(id), details: { fields: Object.keys(patch) }, ipAddress: c.req.header('cf-connecting-ip') })
    return c.json({ person: await getPerson(c.env.DB, id) })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

/** Merge this person into another: their photos become the other's, and this one goes. */
peopleRoutes.post('/:id/merge', requirePermission('people:manage'), async (c) => {
  const id = idOf(c.req.param('id'))
  try {
    const body = await readJsonObject(c)
    const into = typeof body.into === 'number' ? body.into : null
    if (id === null || into === null) return c.json({ error: 'not_found' }, 404)
    const moved = await mergePeople(c.env.DB, id, into)
    if (moved === null) return c.json({ error: 'not_found' }, 404)
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'person.merged', targetType: 'person', targetId: String(into), details: { photos: moved }, ipAddress: c.req.header('cf-connecting-ip') })
    return c.json({ person: await getPerson(c.env.DB, into), moved })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

/** Delete a person and every tag of them. Activity keeps only how many photos lost the tag. */
peopleRoutes.delete('/:id', requirePermission('people:manage'), async (c) => {
  const id = idOf(c.req.param('id'))
  const photos = id === null ? null : await deletePerson(c.env.DB, id)
  if (photos === null) return c.json({ error: 'not_found' }, 404)
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'person.deleted', targetType: 'person', details: { photos }, ipAddress: c.req.header('cf-connecting-ip') })
  return c.body(null, 204)
})
