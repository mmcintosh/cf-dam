/**
 * Face boxes (catalog/faces.ts). Only when this install has faces (`FACES=1` at deploy, PLAN-FN2-v2 §14): otherwise
 * every route here is 404 and nothing about faces is shown anywhere. Turning Find faces on or off and Remove all take
 * `settings:manage`; looking for faces in a browser tab and naming them take `people:manage`. Activity names nobody.
 */
import { Hono, type Context } from 'hono'
import { requirePermission } from '../auth/principal'
import { chooseFaces, claimFaces, FACE_MODEL, faceCounts, facesInstalled, facesSetting, parseFound, parseModel, removeAllFaces, scopeCounts, setFacesOn, storeFound, unnamedFaces, type FaceChoice } from '../catalog/faces'
import { personByName } from '../catalog/people'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject } from '../lib/http'
import { say } from '../lib/language'

export const faceRoutes = new Hono<DamEnv>()

faceRoutes.use('*', async (c, next) => {
  if (!facesInstalled(c.env)) return c.json({ error: 'not_found' }, 404)
  return next()
})

const invalid = (c: Context<DamEnv>, error: unknown) => {
  if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
  throw error
}
const log = (c: Context<DamEnv>, action: string, details?: Record<string, unknown>) =>
  logActivity(c.env.DB, { userId: c.get('principal')!.userId, action, details, ipAddress: c.req.header('cf-connecting-ip') })

/** The switch, the epoch a tab writes under, and the counts for Setup and Remove all's confirmation. */
faceRoutes.get('/status', requirePermission('people:manage'), async (c) => {
  const [setting, counts] = await Promise.all([facesSetting(c.env.DB), faceCounts(c.env.DB)])
  return c.json({ ...setting, removing: setting.removeBefore !== null, model: FACE_MODEL, counts })
})

faceRoutes.put('/settings', requirePermission('settings:manage'), async (c) => {
  try {
    const body = await readJsonObject(c)
    if (typeof body.on !== 'boolean') throw new BadRequest('on must be true or false.')
    // Turning on is a choice made knowing what it means (Faces and the law): the page asks for the tick.
    if (body.on && body.understood !== true) throw new BadRequest(say('err.facesUnderstood'))
    const setting = await setFacesOn(c.env.DB, body.on)
    await log(c, body.on ? 'faces.turned_on' : 'faces.paused')
    return c.json(setting)
  } catch (error) {
    return invalid(c, error)
  }
})

faceRoutes.post('/remove', requirePermission('settings:manage'), async (c) => {
  const outcome = await removeAllFaces(c.env.DB)
  if (outcome === 'on') return c.json({ error: 'faces_on', message: say('err.facesStillOn') }, 409)
  await log(c, 'faces.removed', { boxes: outcome.boxes, named: outcome.named })
  return c.json({ removing: true, counts: outcome })
})

/** Photos in an album or a job to look at in this tab (claimed for ten minutes), with the epoch to write under. */
faceRoutes.get('/queue', requirePermission('people:manage'), async (c) => {
  const album = c.req.query('album')
  const job = c.req.query('job')
  if (!album === !job) return c.json({ error: 'invalid_request', message: 'Give album or job.' }, 400)
  const setting = await facesSetting(c.env.DB)
  if (!setting.on) return c.json({ error: 'faces_off', message: say('err.facesOff') }, 409)
  const scope = album ? { albumId: album } : { jobId: job! }
  // `peek=1`: only the counts, for the panel before anything is claimed.
  const photos = c.req.query('peek') === '1' ? [] : await claimFaces(c.env.DB, scope)
  return c.json({ model: FACE_MODEL, epoch: setting.epoch, photos, counts: await scopeCounts(c.env.DB, scope) })
})

/** What a tab found: `{ model, epoch, photos: [{ assetId, frame, faces } | { assetId, failed: true }] }`. */
faceRoutes.put('/boxes', requirePermission('people:manage'), async (c) => {
  try {
    const body = await readJsonObject(c)
    const model = parseModel(body.model)
    if (typeof body.epoch !== 'number' || !Number.isInteger(body.epoch)) throw new BadRequest('epoch is the one /queue gave.')
    const results = await storeFound(c.env.DB, parseFound(body.photos), model, body.epoch)
    if (results.some((r) => r.status === 'off')) return c.json({ error: 'faces_off', message: say('err.facesOff'), results }, 409)
    return c.json({ results })
  } catch (error) {
    return invalid(c, error)
  }
})

/**
 * Name faces, set them aside or clear them: `{ faceIds, personId | name | setAside | clear }`. Works while Find faces
 * is paused too (naming isn't finding).
 */
faceRoutes.post('/choose', requirePermission('people:manage'), async (c) => {
  try {
    const body = await readJsonObject(c)
    if (!Array.isArray(body.faceIds) || !body.faceIds.every((id) => Number.isInteger(id))) throw new BadRequest('faceIds is a list of face ids.')
    const principal = c.get('principal')!
    let choice: FaceChoice
    if (Number.isInteger(body.personId)) choice = { personId: body.personId as number }
    else if (typeof body.name === 'string') choice = { personId: (await personByName(c.env.DB, body.name, principal.userId)).id }
    else if (typeof body.setAside === 'boolean') choice = { setAside: body.setAside }
    else if (body.clear === true) choice = { clear: true }
    else throw new BadRequest('Give personId, name, setAside or clear.')
    const changed = await chooseFaces(c.env.DB, body.faceIds as number[], choice, principal.userId)
    return c.json({ changed })
  } catch (error) {
    return invalid(c, error)
  }
})

/** Faces to name in an album or a job's albums, largest first, 60 a page (`area` and `after` from the last page's `next`). */
faceRoutes.get('/unnamed', requirePermission('people:manage'), async (c) => {
  const album = c.req.query('album')
  const job = c.req.query('job')
  if (!album === !job) return c.json({ error: 'invalid_request', message: 'Give album or job.' }, 400)
  const area = Number(c.req.query('area'))
  const after = Number(c.req.query('after'))
  const cursor = Number.isInteger(area) && Number.isInteger(after) && c.req.query('after') ? { area, id: after } : null
  return c.json(await unnamedFaces(c.env.DB, album ? { albumId: album } : { jobId: job! }, cursor))
})
