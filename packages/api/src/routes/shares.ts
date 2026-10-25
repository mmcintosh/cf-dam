/**
 * Client gallery links, the photographer's side: make, edit and revoke links to albums, see who
 * opened them and what they picked, and set the watermark.
 */
import { Hono, type Context } from 'hono'
import { requirePermission } from '../auth/principal'
import {
  createShare,
  getShare,
  listShares,
  parseShareInput,
  pickedAssets,
  revokeShare,
  shareDownloads,
  sharePicks,
  shareVisitors,
  updateShare,
  type ShareRow,
} from '../catalog/shares'
import { inviteClient, newInvite, removeMember, shareMembers } from '../catalog/clients'
import { markDelivered } from '../catalog/jobs'
import { getWatermark, MAX_WATERMARK_BYTES, removeWatermarkImage, setWatermarkImage, updateWatermark, watermarkKey, WatermarkRejected, type WatermarkPosition } from '../catalog/watermark'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { randomId } from '../lib/crypto'
import { BadRequest, readJsonObject, requiredEmail, requiredString, stringArray } from '../lib/http'
import { nowIso } from '../lib/time'
import { renditionStore } from '../storage/connections'
import { say } from '../lib/language'
import { emailInvite, mailOn } from '../mail/invite-mail'
import { emailMembers, previewMembersEmail } from '../mail/gallery-mail'

export const shareRoutes = new Hono<DamEnv>()

shareRoutes.use('*', requirePermission('shares:manage'))

/** A final delivery moves the album's job to Delivered; logged as the person's move. */
async function deliver(c: Context<DamEnv>, albumId: string): Promise<void> {
  const moved = await markDelivered(c.env.DB, albumId)
  if (!moved) return
  await logActivity(c.env.DB, {
    userId: c.get('principal')!.userId,
    action: 'job.stage',
    targetType: 'job',
    targetId: moved.jobId,
    details: { title: moved.title, from: moved.from, to: 'delivered', by: 'final_delivery' },
    ipAddress: c.req.header('cf-connecting-ip'),
  })
}

const invalid = (error: unknown) => {
  if (error instanceof BadRequest || error instanceof WatermarkRejected) return { error: 'invalid_request', message: error.message }
  throw error
}

shareRoutes.get('/', async (c) => c.json({ shares: await listShares(c.env.DB, c.req.query('albumId') || undefined) }))

shareRoutes.post('/', async (c) => {
  try {
    const body = await readJsonObject(c)
    const albumId = requiredString(body, 'albumId', 64)
    const principal = c.get('principal')!
    const share = await createShare(c.env.DB, albumId, parseShareInput(body, true), principal.userId)
    if (!share) return c.json({ error: 'not_found', message: say('err.noAlbum') }, 404)
    await logActivity(c.env.DB, { userId: principal.userId, action: 'share.create', targetType: 'share', targetId: share.id, details: { albumId }, ipAddress: c.req.header('cf-connecting-ip') })
    if (share.finalDelivery) await deliver(c, albumId)
    return c.json({ share }, 201)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

// The watermark routes come before /:id so "watermark" isn't taken for a link id.
shareRoutes.get('/watermark', async (c) => c.json({ watermark: await getWatermark(c.env.DB) }))

shareRoutes.patch('/watermark', async (c) => {
  try {
    const body = await readJsonObject(c)
    const watermark = await updateWatermark(c.env, {
      position: typeof body.position === 'string' ? (body.position as WatermarkPosition) : undefined,
      scale: typeof body.scale === 'number' ? body.scale : undefined,
      opacity: typeof body.opacity === 'number' ? body.opacity : undefined,
    })
    return c.json({ watermark })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

shareRoutes.get('/watermark/image', async (c) => {
  const { version } = await getWatermark(c.env.DB)
  const object = version ? await renditionStore(c.env).get(watermarkKey(version)) : null
  if (!object) return c.json({ error: 'not_found' }, 404)
  return new Response(object.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' } })
})

shareRoutes.put('/watermark/image', async (c) => {
  const length = Number(c.req.header('Content-Length') ?? NaN)
  if (!Number.isFinite(length) || length > MAX_WATERMARK_BYTES) return c.json({ error: 'invalid_request', message: say('err.watermarkSize') }, 400)
  try {
    const watermark = await setWatermarkImage(c.env, await c.req.arrayBuffer())
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'watermark.set', ipAddress: c.req.header('cf-connecting-ip') })
    return c.json({ watermark })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

shareRoutes.delete('/watermark/image', async (c) => c.json({ watermark: await removeWatermarkImage(c.env.DB) }))

shareRoutes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const share = await getShare(c.env.DB, id)
  if (!share) return c.json({ error: 'not_found' }, 404)
  const [visitors, picks, downloads] = await Promise.all([shareVisitors(c.env.DB, id), sharePicks(c.env.DB, id), shareDownloads(c.env.DB, id)])
  return c.json({ share, visitors, picks, downloads })
})

shareRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const input = parseShareInput(await readJsonObject(c), false)
    const changed = await updateShare(c.env.DB, id, input)
    if (!changed) return c.json({ error: 'not_found', message: say('err.linkGone') }, 404)
    const share = (await getShare(c.env.DB, id))!
    if (input.finalDelivery) await deliver(c, share.albumId)
    return c.json({ share })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

shareRoutes.post('/:id/revoke', async (c) => {
  const id = c.req.param('id')
  if (!(await revokeShare(c.env.DB, id))) return c.json({ error: 'not_found', message: say('err.linkAlreadyRevoked') }, 404)
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'share.revoke', targetType: 'share', targetId: id, ipAddress: c.req.header('cf-connecting-ip') })
  return c.json({ share: await getShare(c.env.DB, id) })
})

/** A new album holding the photos picked on this link: by any of the chosen people, or by all of them. */
shareRoutes.post('/:id/picks/album', async (c) => {
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    const share = await c.env.DB.prepare('SELECT id, album_id FROM shares WHERE id = ?').bind(id).first<Pick<ShareRow, 'id' | 'album_id'>>()
    if (!share) return c.json({ error: 'not_found' }, 404)
    const name = requiredString(body, 'name', 200)
    const visitorIds = stringArray(body, 'visitorIds') ?? null
    const mode = body.mode === 'all' ? 'all' : 'any'
    const assetIds = await pickedAssets(c.env.DB, share, visitorIds && visitorIds.length > 0 ? visitorIds : null, mode)
    if (assetIds.length === 0) throw new BadRequest(say('err.nothingPicked'))
    const albumId = randomId()
    const now = nowIso()
    const principal = c.get('principal')!
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO albums (id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(albumId, name, '', principal.userId, now, now),
      c.env.DB.prepare(
        `INSERT INTO album_items (album_id, asset_id, position, added_at)
         SELECT ?, value, key, ? FROM json_each(?)`,
      ).bind(albumId, now, JSON.stringify(assetIds)),
    ])
    return c.json({ albumId, count: assetIds.length }, 201)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

// ---------------------------------------------------------------------------------------------------
// Clients with accounts on a link (catalog/clients.ts).

shareRoutes.get('/:id/members', async (c) => {
  const id = c.req.param('id')
  if (!(await c.env.DB.prepare('SELECT 1 FROM shares WHERE id = ?').bind(id).first())) return c.json({ error: 'not_found' }, 404)
  // mailOn: whether the invite form can offer to email the invitation.
  return c.json({ members: await shareMembers(c.env.DB, id), mailOn: await mailOn(c.env) })
})

/** Email a new invite for this gallery when asked and email works. Returns whether it was queued. */
async function emailGalleryInvite(c: Context<DamEnv>, shareId: string, member: { userId: string; name: string; email: string }, invite: { token: string; expiresAt: string }): Promise<boolean> {
  const share = await c.env.DB.prepare('SELECT title, name, language FROM shares WHERE id = ?').bind(shareId).first<{ title: string; name: string; language: string | null }>()
  const principal = c.get('principal')!
  return emailInvite(c.env, {
    kind: 'client',
    ...member,
    ...invite,
    by: { userId: principal.userId, name: principal.name },
    gallery: { title: share?.title || share?.name || '', language: share?.language ?? null },
  })
}

/** Invite a client to this link. The answer carries a one-time invite token when they still need to choose a password. */
shareRoutes.post('/:id/members', async (c) => {
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    const name = requiredString(body, 'name', 100)
    const email = requiredEmail(body)
    const share = await c.env.DB.prepare('SELECT id, revoked_at FROM shares WHERE id = ?').bind(id).first<Pick<ShareRow, 'id' | 'revoked_at'>>()
    if (!share || share.revoked_at) return c.json({ error: 'not_found', message: say('err.linkGone') }, 404)
    const principal = c.get('principal')!
    const outcome = await inviteClient(c.env, c.req.raw, share, { name, email }, principal.userId)
    if (outcome.kind === 'team') return c.json({ error: 'on_the_team', message: outcome.message }, 409)
    await logActivity(c.env.DB, {
      userId: principal.userId,
      action: 'client.invited',
      targetType: 'user',
      targetId: outcome.member.userId,
      details: { email, shareId: id },
      ipAddress: c.req.header('cf-connecting-ip'),
    })
    const emailed = outcome.invite && body.sendEmail === true ? await emailGalleryInvite(c, id, outcome.member, outcome.invite) : false
    return c.json({ member: outcome.member, invite: outcome.invite, emailed }, 201)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

/** What "Email the members" would send, and to how many. */
shareRoutes.get('/:id/email-members', async (c) => {
  const preview = await previewMembersEmail(c.env, c.req.param('id'), new URL(c.req.url).origin)
  return preview ? c.json(preview) : c.json({ error: 'not_found' }, 404)
})

/** "Email the members": the gallery's members who have joined get "A gallery for you" (at most every six hours). */
shareRoutes.post('/:id/email-members', async (c) => {
  const id = c.req.param('id')
  const principal = c.get('principal')!
  const outcome = await emailMembers(c.env, id, principal.userId)
  switch (outcome.kind) {
    case 'not_found':
      return c.json({ error: 'not_found' }, 404)
    case 'off':
      return c.json({ error: 'mail_off', message: say('err.mailOffShort') }, 409)
    case 'too_soon':
      return c.json({ error: 'too_soon', message: say('err.membersEmailedRecently'), next: outcome.next }, 429)
    case 'cap':
      return c.json({ error: 'too_many', message: say('err.membersEmailCap') }, 429)
    case 'none':
      return c.json({ error: 'no_members', message: say('err.noMembersToEmail') }, 409)
  }
  await logActivity(c.env.DB, { userId: principal.userId, action: 'share.members_emailed', targetType: 'share', targetId: id, details: { count: outcome.count }, ipAddress: c.req.header('cf-connecting-ip') })
  return c.json({ sent: outcome.count })
})

/** A new invite link for a client who hasn't joined yet (the old one stops working). */
shareRoutes.post('/:id/members/:userId/invite', async (c) => {
  const { id, userId } = c.req.param()
  const member = (await shareMembers(c.env.DB, id)).find((m) => m.userId === userId)
  if (!member) return c.json({ error: 'not_found' }, 404)
  if (member.joined) return c.json({ error: 'joined', message: say('err.clientJoined') }, 409)
  const invite = await newInvite(c.env.DB, userId, c.get('principal')!.userId)
  const body = (await c.req.json().catch(() => ({}))) as { sendEmail?: unknown }
  const emailed = body.sendEmail === true ? await emailGalleryInvite(c, id, member, invite) : false
  return c.json({ invite, emailed })
})

/** Take a client off this link. Their account stays (for other galleries); People is where accounts are removed. */
shareRoutes.delete('/:id/members/:userId', async (c) => {
  const { id, userId } = c.req.param()
  if (!(await removeMember(c.env.DB, id, userId))) return c.json({ error: 'not_found' }, 404)
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'client.removed', targetType: 'user', targetId: userId, details: { shareId: id }, ipAddress: c.req.header('cf-connecting-ip') })
  return c.body(null, 204)
})
