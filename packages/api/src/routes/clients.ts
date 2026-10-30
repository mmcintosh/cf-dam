/**
 * Clients (catalog/client-records.ts): contact details, notes, the logins that belong to them, and what was
 * shared with them. Administrators only (`clients:manage`).
 */
import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import {
  addPerson,
  clientDownloads,
  clientPeople,
  createClient,
  eraseClient,
  getClient,
  linkPerson,
  listClients,
  parseClientInput,
  setPast,
  unlinkedLogins,
  unlinkPerson,
  updateClient,
} from '../catalog/client-records'
import { clientShares } from '../catalog/shares'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject, requiredEmail, requiredString } from '../lib/http'
import { say } from '../lib/language'
import { emailInvite } from '../mail/invite-mail'

export const clientRoutes = new Hono<DamEnv>()

clientRoutes.use('*', requirePermission('clients:manage'))

const invalid = (error: unknown) => {
  if (error instanceof BadRequest) return { error: 'invalid_request', message: error.message }
  throw error
}
const notFound = () => ({ error: 'not_found', message: say('err.noClient') })

clientRoutes.get('/', async (c) => c.json({ clients: await listClients(c.env.DB, { q: c.req.query('q'), past: c.req.query('past') === '1' }) }))

clientRoutes.post('/', async (c) => {
  try {
    const input = parseClientInput(await readJsonObject(c), true)
    const principal = c.get('principal')!
    const id = await createClient(c.env.DB, input, principal.userId)
    await logActivity(c.env.DB, { userId: principal.userId, action: 'client.created', targetType: 'client', targetId: id, details: { name: input.name }, ipAddress: c.req.header('cf-connecting-ip') })
    return c.json({ client: await getClient(c.env.DB, id) }, 201)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

/** Everything on a client's page: details, people, galleries and downloads. */
clientRoutes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const client = await getClient(c.env.DB, id)
  if (!client) return c.json(notFound(), 404)
  const [people, galleries, downloads] = await Promise.all([clientPeople(c.env.DB, id), clientShares(c.env.DB, id), clientDownloads(c.env.DB, id)])
  return c.json({ client, people, galleries, downloads })
})

clientRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const input = parseClientInput(await readJsonObject(c), false)
    const fields = await updateClient(c.env.DB, id, input)
    if (!fields) return c.json(notFound(), 404)
    const client = (await getClient(c.env.DB, id))!
    if (fields.length > 0) {
      await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'client.updated', targetType: 'client', targetId: id, details: { name: client.name, fields }, ipAddress: c.req.header('cf-connecting-ip') })
    }
    return c.json({ client })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

/** `{ past: true }` marks a past client (hidden from the list by default); false makes them current again. */
clientRoutes.post('/:id/past', async (c) => {
  const id = c.req.param('id')
  const body = await readJsonObject(c).catch(() => ({}) as Record<string, unknown>)
  if (typeof body.past !== 'boolean') return c.json({ error: 'invalid_request', message: 'past must be true or false.' }, 400)
  if (!(await setPast(c.env.DB, id, body.past))) return c.json(notFound(), 404)
  const client = (await getClient(c.env.DB, id))!
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: body.past ? 'client.past' : 'client.current', targetType: 'client', targetId: id, details: { name: client.name }, ipAddress: c.req.header('cf-connecting-ip') })
  return c.json({ client })
})

/** Client logins not linked to anyone yet, the likely ones first. */
clientRoutes.get('/:id/candidates', async (c) => c.json({ candidates: await unlinkedLogins(c.env.DB, c.req.param('id')) }))

/**
 * Add a person: `{ userId }` links an existing client login; `{ name, email }` finds or makes the login and
 * links it, answering with a one-time invite while they still need to choose a password.
 */
clientRoutes.post('/:id/people', async (c) => {
  const id = c.req.param('id')
  const principal = c.get('principal')!
  try {
    const body = await readJsonObject(c)
    if (typeof body.userId === 'string') {
      const outcome = await linkPerson(c.env.DB, id, body.userId, principal.userId)
      if (outcome.kind === 'not_found') return c.json(notFound(), 404)
      if (outcome.kind === 'team') return c.json({ error: 'on_the_team', message: say('err.teamNotClient') }, 409)
      if (outcome.kind === 'elsewhere') return c.json({ error: 'linked_elsewhere', message: say('err.clientElsewhere', { client: outcome.clientName }) }, 409)
      await logActivity(c.env.DB, { userId: principal.userId, action: 'client.linked', targetType: 'user', targetId: body.userId, details: { clientId: id }, ipAddress: c.req.header('cf-connecting-ip') })
      return c.json({ people: await clientPeople(c.env.DB, id), invite: null }, 201)
    }
    const name = requiredString(body, 'name', 100)
    const email = requiredEmail(body)
    // Someone already linked gets a new invite rather than being linked again.
    const already = await c.env.DB.prepare('SELECT 1 FROM client_people p JOIN users u ON u.id = p.user_id WHERE p.client_id = ? AND lower(u.email) = ?').bind(id, email).first()
    const outcome = await addPerson(c.env, c.req.raw, id, { name, email }, principal.userId)
    if (!outcome) return c.json(notFound(), 404)
    if (outcome.kind === 'team') return c.json({ error: 'on_the_team', message: say('err.teamNotClient') }, 409)
    if (outcome.kind === 'elsewhere') return c.json({ error: 'linked_elsewhere', message: say('err.clientElsewhere', { client: outcome.clientName }) }, 409)
    await logActivity(c.env.DB, { userId: principal.userId, action: already ? 'client.invited' : 'client.linked', targetType: 'user', targetId: outcome.userId, details: { clientId: id, email }, ipAddress: c.req.header('cf-connecting-ip') })
    const emailed =
      outcome.invite && body.sendEmail === true
        ? await emailInvite(c.env, { kind: 'client', userId: outcome.userId, name, email, ...outcome.invite, by: { userId: principal.userId, name: principal.name } })
        : false
    return c.json({ people: await clientPeople(c.env.DB, id), invite: outcome.invite, userId: outcome.userId, emailed }, 201)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

/** Unlink a login. It stays, with its galleries; People is where logins are removed. */
clientRoutes.delete('/:id/people/:userId', async (c) => {
  const { id, userId } = c.req.param()
  if (!(await unlinkPerson(c.env.DB, id, userId))) return c.json(notFound(), 404)
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'client.unlinked', targetType: 'user', targetId: userId, details: { clientId: id }, ipAddress: c.req.header('cf-connecting-ip') })
  return c.body(null, 204)
})

/**
 * Erase the client and their logins (catalog/client-records.ts eraseClient). `{ confirm }` must repeat the
 * client's name, so it can't happen by a stray click.
 */
clientRoutes.post('/:id/erase', async (c) => {
  const id = c.req.param('id')
  const client = await getClient(c.env.DB, id)
  if (!client) return c.json(notFound(), 404)
  const body = await readJsonObject(c).catch(() => ({}) as Record<string, unknown>)
  if (typeof body.confirm !== 'string' || body.confirm.trim().toLowerCase() !== client.name.trim().toLowerCase()) {
    return c.json({ error: 'invalid_request', message: say('err.eraseConfirm') }, 400)
  }
  const erased = (await eraseClient(c.env.DB, id, { namedPeople: body.namedPeople === true }))!
  // No name or email: the point is that they're gone.
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'client.erased', targetType: 'client', targetId: id, details: { people: erased.people, namedPeople: erased.namedPeople }, ipAddress: c.req.header('cf-connecting-ip') })
  return c.json(erased)
})
