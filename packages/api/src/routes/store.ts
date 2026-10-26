/**
 * Selling, for buyers and Stripe (plans/PLAN-SELL-v2.md), with no sign-in:
 *  - an order by its link (`/api/public/orders/:id?k=`), which also brings it up to date with Stripe while it's open;
 *  - a bought file from that order;
 *  - Stripe's webhook: signature checked first, the event recorded, the order brought up to date by reading Stripe.
 */
import { Hono, type Context } from 'hono'
import type { DamEnv, DamBindings } from '../env'
import { getAsset, getLocations, reachableForClient } from '../catalog/assets'
import { clientFileBase, JPEG_LONG_EDGE } from '../catalog/shares'
import { galleryImage } from '../catalog/watermark'
import { nowIso } from '../lib/time'
import { chargeChanged, fulfil, orderByLink } from '../selling/orders'
import { getPaymentSecret } from '../selling/settings'
import { verifyStripeSignature } from '../selling/stripe'
import { originalResponse } from '../storage/original'
import { attachmentDisposition, StorageError } from '../storage/types'

export const storeRoutes = new Hono<DamEnv>()

// Order pages and files only (this router sits under /public beside the galleries, whose images cache).
storeRoutes.use('/orders/*', async (c, next) => {
  await next()
  c.res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  c.res.headers.set('Referrer-Policy', 'no-referrer')
  c.res.headers.set('Cache-Control', 'private, no-store')
})

export interface BoughtItem {
  asset_id: string | null
  size: string
  filename: string
  /** Set at checkout (migration 0061): the real filename if the gallery showed filenames, and the photo's place. */
  label: string | null
  n: number | null
  gallery_name: string
}

/** The columns `deliverItem` needs, from order_items `i` joined to orders `o`. */
export const BOUGHT_ITEM_COLUMNS = 'i.asset_id, i.size, i.filename, i.label, i.n, o.gallery_name'

/**
 * The file an order item bought, made the same way whether reached by the order link or the buyer's cookie. Named as
 * the buyer saw it: the real filename only if the gallery showed filenames, otherwise "smith-wedding-042".
 */
export async function deliverItem(c: Context<DamEnv>, item: BoughtItem): Promise<Response> {
  if (!item.asset_id) return c.json({ error: 'gone', message: 'This photo is no longer in the archive. Ask the photographer.' }, 410)
  const env: DamBindings = c.env
  const asset = await getAsset(env.DB, item.asset_id)
  if (!asset) return c.json({ error: 'gone' }, 410)
  const base = clientFileBase({ title: item.gallery_name, showFilenames: item.label !== null }, item.label ?? item.filename, item.n)
  if (item.size === 'full') {
    const { results: nas } = await env.DB.prepare("SELECT id FROM storage_connections WHERE provider = 'nas'").all<{ id: string }>()
    const location = reachableForClient(await getLocations(env.DB, asset.id), new Set(nas.map((n) => n.id)))
    if (!location) return c.json({ error: 'unavailable', message: 'The original is being brought back from storage. Try again later or ask the photographer.' }, 409)
    try {
      const downloadName = base + (/\.[^.]*$/.exec(asset.filename)?.[0] ?? '')
      return (await originalResponse(env, c.req.raw, asset, location, { downloadName, presign: false })) ?? c.json({ error: 'unavailable' }, 409)
    } catch (error) {
      if (error instanceof StorageError) return c.json({ error: 'unavailable' }, 502)
      throw error
    }
  }
  const size = item.size === 'small' ? 'small' : 'large'
  // Bought: never watermarked.
  const image = await galleryImage(env, asset.id, size, { watermark: false, longEdge: JPEG_LONG_EDGE[size] })
  if (!image) return c.json({ error: 'unavailable' }, 409)
  return new Response(image.body, {
    headers: { 'Content-Type': image.contentType, 'Content-Length': String(image.size), 'Content-Disposition': attachmentDisposition(`${base}-${size}.jpg`) },
  })
}

storeRoutes.get('/orders/:id', async (c) => {
  const id = c.req.param('id')
  const key = c.req.query('k') ?? ''
  let order = await orderByLink(c.env.DB, id, key)
  if (!order) return c.json({ error: 'not_found' }, 404)
  // Still open: ask Stripe (the success page polls this; a missed webhook doesn't strand the buyer).
  if (order.status === 'open') {
    await fulfil(c.env, id).catch((e) => console.warn('[store] fulfil', e))
    order = (await orderByLink(c.env.DB, id, key))!
  }
  return c.json({ order })
})

storeRoutes.get('/orders/:id/items/:itemId', async (c) => {
  const order = await orderByLink(c.env.DB, c.req.param('id'), c.req.query('k') ?? '')
  if (!order) return c.json({ error: 'not_found' }, 404)
  if (order.status !== 'paid') return c.json({ error: 'not_paid', message: 'This order isn’t paid, or was refunded.' }, 403)
  const item = await c.env.DB.prepare(`SELECT ${BOUGHT_ITEM_COLUMNS}, i.refunded_at FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ? AND i.order_id = ?`)
    .bind(c.req.param('itemId'), order.id)
    .first<BoughtItem & { refunded_at: string | null }>()
  if (!item || item.refunded_at) return c.json({ error: 'not_found' }, 404)
  return deliverItem(c, item)
})

/** Stripe's webhook: verify, record, then bring the order up to date from Stripe itself. */
storeRoutes.post('/stripe/webhook', async (c) => {
  const secret = await getPaymentSecret(c.env, 'stripe_webhook')
  const raw = await c.req.text()
  if (!secret || !(await verifyStripeSignature(raw, c.req.header('Stripe-Signature') ?? null, secret))) return c.json({ error: 'bad_signature' }, 400)
  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } }
  try {
    event = JSON.parse(raw)
  } catch {
    return c.json({ error: 'bad_json' }, 400)
  }
  if (!event.id || !event.type) return c.json({ error: 'bad_event' }, 400)
  const object = event.data?.object ?? {}
  const sessionId = typeof object.object === 'string' && object.object === 'checkout.session' ? String(object.id) : null
  const db = c.env.DB
  // Seen and done: nothing more to do. Seen but not done (a failure part-way): try again.
  const seen = await db.prepare('SELECT processed_at FROM stripe_events WHERE id = ?').bind(event.id).first<{ processed_at: string | null }>()
  if (seen?.processed_at) return c.json({ received: true })
  if (!seen) await db.prepare('INSERT OR IGNORE INTO stripe_events (id, type, session_id, created_at) VALUES (?, ?, ?, ?)').bind(event.id, event.type, sessionId, nowIso()).run()

  if (event.type.startsWith('checkout.session.') && sessionId) {
    const order = await db.prepare('SELECT id FROM orders WHERE session_id = ?').bind(sessionId).first<{ id: string }>()
    if (order) await fulfil(c.env, order.id)
  } else if (event.type === 'charge.refunded') {
    const pi = typeof object.payment_intent === 'string' ? object.payment_intent : null
    if (pi) await chargeChanged(db, pi, object.refunded === true ? 'refunded' : 'partly_refunded')
  } else if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
    const pi = typeof object.payment_intent === 'string' ? object.payment_intent : null
    if (pi) await chargeChanged(db, pi, event.type === 'charge.dispute.created' ? 'disputed' : object.status === 'won' ? 'dispute_won' : 'dispute_lost')
  }
  await db.prepare('UPDATE stripe_events SET processed_at = ? WHERE id = ?').bind(nowIso(), event.id).run()
  return c.json({ received: true })
})
