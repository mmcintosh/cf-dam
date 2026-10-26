/**
 * Paid digital downloads (plans/PLAN-SELL-v2.md S1): price lists, a gallery's prices, checkout, and turning a Stripe
 * payment into downloads.
 *
 * Money rules:
 *  - Amounts come from the price list, never the browser, and are snapshotted into the order when checkout starts.
 *  - Stripe's API is the source of truth. A webhook, the success page's poll and the sweep all only *trigger*
 *    `fulfil`, which reads the Checkout Session from Stripe and acts on that: a lost webhook delays an order, it never
 *    strands it. Every change is a conditional update, so running it twice changes nothing.
 *  - Paid totals are checked against the snapshot; anything that doesn't add up waits for a person (needs_review).
 *  - Test and live never mix: an order records which it was paid in.
 */
import type { DamBindings } from '../env'
import { randomId, sha256Hex } from '../lib/crypto'
import { BadRequest } from '../lib/http'
import { nowIso } from '../lib/time'
import { getAsset, getLocations, reachableForClient } from '../catalog/assets'
import { GALLERY_ORDER, galleryNumber, type ShareRow } from '../catalog/shares'
import { say } from '../lib/language'
import { CURRENCIES, getPaymentSecret, getPaymentSettings, keyMode } from './settings'
import { sessionPaymentIntent, stripe, type CheckoutSession } from './stripe'

export const SIZES = ['small', 'large', 'full'] as const
export type SaleSize = (typeof SIZES)[number]
const SIZE_NAMES = { small: 'gallery.size.small', large: 'gallery.size.large', full: 'gallery.buy.full' } as const

export interface PriceList {
  id: string
  name: string
  small: number | null
  large: number | null
  full: number | null
  all: number | null
}

interface PriceRow {
  id: string
  name: string
  small: number | null
  large: number | null
  full_size: number | null
  all_photos: number | null
}

const priceJson = (r: PriceRow): PriceList => ({ id: r.id, name: r.name, small: r.small, large: r.large, full: r.full_size, all: r.all_photos })

export async function listPriceLists(db: D1Database): Promise<PriceList[]> {
  const { results } = await db.prepare('SELECT id, name, small, large, full_size, all_photos FROM price_lists ORDER BY name').all<PriceRow>()
  return results.map(priceJson)
}

export async function getPriceList(db: D1Database, id: string): Promise<PriceList | null> {
  const row = await db.prepare('SELECT id, name, small, large, full_size, all_photos FROM price_lists WHERE id = ?').bind(id).first<PriceRow>()
  return row ? priceJson(row) : null
}

/** Check a price list someone sends: whole minor units, at least Stripe's minimum, or null (not sold). */
export function parsePriceList(body: Record<string, unknown>, currency: string): Omit<PriceList, 'id'> {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 100) throw new BadRequest('A name of up to 100 characters.')
  const { minimum } = CURRENCIES[currency] ?? CURRENCIES.usd!
  const amount = (field: string): number | null => {
    const v = body[field]
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'number' || !Number.isInteger(v) || v < minimum || v > 100_000_000) throw new BadRequest(`${field}: a whole number of minor units from ${minimum}, or empty.`)
    return v
  }
  return { name, small: amount('small'), large: amount('large'), full: amount('full'), all: amount('all') }
}

export async function savePriceList(db: D1Database, id: string | null, list: Omit<PriceList, 'id'>): Promise<string> {
  const now = nowIso()
  if (id) {
    const r = await db.prepare('UPDATE price_lists SET name = ?, small = ?, large = ?, full_size = ?, all_photos = ?, updated_at = ? WHERE id = ?').bind(list.name, list.small, list.large, list.full, list.all, now, id).run()
    if (r.meta.changes !== 1) throw new BadRequest('No such price list.')
    return id
  }
  const newId = randomId()
  await db.prepare('INSERT INTO price_lists (id, name, small, large, full_size, all_photos, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(newId, list.name, list.small, list.large, list.full, list.all, now, now).run()
  return newId
}

/** What a gallery sells, or null when it sells nothing (no price list, or Stripe isn't connected). */
export async function galleryStore(env: DamBindings, share: Pick<ShareRow, 'price_list_id' | 'download_sizes'>): Promise<{ currency: string; prices: Omit<PriceList, 'id' | 'name'> } | null> {
  if (!share.price_list_id) return null
  const [list, key, webhook, settings] = await Promise.all([getPriceList(env.DB, share.price_list_id), getPaymentSecret(env, 'stripe_key'), getPaymentSecret(env, 'stripe_webhook'), getPaymentSettings(env.DB)])
  if (!list || !key || !webhook) return null
  // A size the gallery gives away free isn't also sold.
  const free = new Set(JSON.parse(share.download_sizes || '[]') as string[])
  const prices = {
    small: free.has('small') ? null : list.small,
    large: free.has('large') ? null : list.large,
    full: free.has('original') ? null : list.full,
    all: list.all,
  }
  return Object.values(prices).some((p) => p !== null) ? { currency: settings.currency, prices } : null
}

/**
 * Whether this photo can be sold at this size now. Small and Large are made from the photo's preview; Full size is
 * the original itself, so only a JPEG or PNG with no edits in cf-dam (an edited or RAW original would need a print
 * master: plan §6), readable now (not on a NAS, not in deep storage).
 */
export async function sellable(env: DamBindings, assetId: string, size: SaleSize): Promise<boolean> {
  const asset = await getAsset(env.DB, assetId)
  if (!asset || asset.deleted_at || asset.mime_type.startsWith('video/')) return false
  if (size !== 'full') return true
  if (!['image/jpeg', 'image/png'].includes(asset.mime_type) || asset.edit) return false
  const { results: nas } = await env.DB.prepare("SELECT id FROM storage_connections WHERE provider = 'nas'").all<{ id: string }>()
  return reachableForClient(await getLocations(env.DB, assetId), new Set(nas.map((n) => n.id))) !== null
}

export type CheckoutRequest = { assetId: string; size: SaleSize } | { all: true }

/**
 * Start paying: the order (with its prices snapshotted) and a Stripe Checkout Session. Returns Stripe's page to send
 * the buyer to, and the order's link (shown on the success page and kept for downloads).
 */
export async function startCheckout(
  env: DamBindings,
  share: ShareRow,
  buyer: string,
  request: CheckoutRequest,
  origin: string,
): Promise<{ url: string; orderId: string }> {
  const db = env.DB
  const store = await galleryStore(env, share)
  const key = await getPaymentSecret(env, 'stripe_key')
  if (!store || !key) throw new BadRequest('This gallery sells nothing.')
  const settings = await getPaymentSettings(db)

  // What's being bought, at today's prices. The buyer sees a photo by its real name only when the gallery shows
  // filenames; otherwise as "Photo 42", its place in the gallery (n), also on Stripe's page and receipt.
  const showFilenames = share.show_filenames === 1
  const label = (filename: string) => (showFilenames ? filename : null)
  let items: { assetId: string; filename: string; n: number; label: string | null; size: SaleSize; amount: number }[]
  let lines: Record<string, unknown>[]
  if ('all' in request) {
    if (store.prices.all === null) throw new BadRequest('The whole gallery isn’t for sale.')
    // In the gallery's order, numbered as the gallery shows them (videos count), then photos only.
    const { results: shown } = await db
      .prepare(`SELECT a.id, a.filename, a.mime_type FROM album_items ai JOIN assets a ON a.id = ai.asset_id AND a.deleted_at IS NULL WHERE ai.album_id = ? ORDER BY ${GALLERY_ORDER} LIMIT 2000`)
      .bind(share.album_id)
      .all<{ id: string; filename: string; mime_type: string }>()
    const photos = shown.map((p, i) => ({ ...p, n: i + 1 })).filter((p) => !p.mime_type.startsWith('video/'))
    if (photos.length === 0) throw new BadRequest('Nothing to buy.')
    // Every photo at Large (or Small), for one price; the order lists each file.
    const size: SaleSize = store.prices.large !== null || share.download_sizes.includes('large') ? 'large' : 'small'
    items = photos.map((p, i) => ({ assetId: p.id, filename: p.filename, n: p.n, label: label(p.filename), size, amount: i === 0 ? store.prices.all! : 0 }))
    lines = [{ quantity: 1, price_data: { currency: store.currency, unit_amount: store.prices.all, product_data: { name: `${share.title || share.name}: ${photos.length} photos`, metadata: { kind: 'all' } } } }]
  } else {
    const amount = store.prices[request.size]
    if (amount === null || amount === undefined) throw new BadRequest('That size isn’t for sale.')
    const n = await galleryNumber(db, share, request.assetId)
    if (n === null || !(await sellable(env, request.assetId, request.size))) throw new BadRequest('That photo can’t be bought at that size.')
    const asset = (await getAsset(db, request.assetId))!
    items = [{ assetId: asset.id, filename: asset.filename, n, label: label(asset.filename), size: request.size, amount }]
    // In the gallery's language (the gallery route set it): "Photo 42 · Large (2048 px)".
    const name = `${label(asset.filename) ?? say('order.photoN', { n })} · ${say(SIZE_NAMES[request.size])}`
    lines = [{ quantity: 1, price_data: { currency: store.currency, unit_amount: amount, product_data: { name, metadata: { kind: request.size } } } }]
  }

  const orderId = randomId()
  const linkKey = randomId() + randomId()
  const subtotal = items.reduce((n, i) => n + i.amount, 0)
  const now = nowIso()
  await db.batch([
    db
      .prepare(
        `INSERT INTO orders (id, share_id, gallery_name, share_token, buyer, status, currency, amount_subtotal, link_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
      )
      .bind(orderId, share.id, share.title || share.name, share.token, buyer, store.currency, subtotal, await sha256Hex(linkKey), now, now),
    db
      .prepare(
        `INSERT INTO order_items (id, order_id, asset_id, filename, n, label, size, unit_amount)
         SELECT lower(hex(randomblob(16))), ?, json_extract(j.value, '$.assetId'), json_extract(j.value, '$.filename'), json_extract(j.value, '$.n'),
                json_extract(j.value, '$.label'), json_extract(j.value, '$.size'), json_extract(j.value, '$.amount')
         FROM json_each(?) j`,
      )
      .bind(orderId, JSON.stringify(items)),
  ])

  const orderLink = `${origin}/s/${share.token}/order/${orderId}?k=${linkKey}`
  const session = await stripe<CheckoutSession>(
    key,
    'POST',
    '/checkout/sessions',
    {
      mode: 'payment',
      line_items: lines,
      client_reference_id: orderId,
      metadata: { order_id: orderId, cf_dam: '1' },
      payment_intent_data: { metadata: { order_id: orderId } },
      success_url: `${orderLink}&paid=1`,
      cancel_url: `${origin}/s/${share.token}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      ...(settings.terms ? { custom_text: { submit: { message: settings.terms.slice(0, 1000) } } } : {}),
    },
    orderId,
  )
  await db.prepare('UPDATE orders SET session_id = ?, livemode = ?, updated_at = ? WHERE id = ?').bind(session.id, session.livemode ? 1 : 0, nowIso(), orderId).run()
  if (!session.url) throw new Error('Stripe gave no checkout page.')
  return { url: session.url, orderId }
}

interface OrderRow {
  id: string
  status: string
  currency: string
  amount_subtotal: number
  session_id: string | null
  created_at: string
}

/**
 * Bring an order up to date with Stripe: read its Checkout Session and act on that. Safe to run any number of times.
 * Returns the order's status afterwards.
 */
export async function fulfil(env: DamBindings, orderId: string): Promise<string | null> {
  const db = env.DB
  const order = await db.prepare('SELECT id, status, currency, amount_subtotal, session_id, created_at FROM orders WHERE id = ?').bind(orderId).first<OrderRow>()
  if (!order) return null
  if (order.status !== 'open' || !order.session_id) return order.status
  const key = await getPaymentSecret(env, 'stripe_key')
  if (!key) return order.status
  const session = await stripe<CheckoutSession>(key, 'GET', `/checkout/sessions/${order.session_id}`)
  const now = nowIso()
  if (session.status === 'expired') {
    await db.prepare("UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'open'").bind(now, orderId).run()
    return 'expired'
  }
  if (session.payment_status !== 'paid') return 'open'

  // The money must match what was snapshotted, in this account's mode.
  const problems: string[] = []
  if (session.currency !== order.currency) problems.push(`currency ${session.currency}, expected ${order.currency}`)
  if (session.amount_subtotal !== order.amount_subtotal) problems.push(`subtotal ${session.amount_subtotal}, expected ${order.amount_subtotal}`)
  const extra = (session.total_details?.amount_tax ?? 0) + (session.total_details?.amount_shipping ?? 0) - (session.total_details?.amount_discount ?? 0)
  if (session.amount_total !== (session.amount_subtotal ?? 0) + extra) problems.push(`total ${session.amount_total} doesn't add up`)
  if ((keyMode(key) === 'live') !== session.livemode) problems.push('test and live mixed')
  const status = problems.length ? 'needs_review' : 'paid'
  await db
    .prepare(
      `UPDATE orders SET status = ?, amount_total = ?, amount_tax = ?, email = ?, name = ?, payment_intent = ?, livemode = ?, problem = ?, paid_at = ?, updated_at = ?
       WHERE id = ? AND status = 'open'`,
    )
    .bind(
      status,
      session.amount_total,
      session.total_details?.amount_tax ?? 0,
      session.customer_details?.email?.slice(0, 254) ?? null,
      session.customer_details?.name?.slice(0, 200) ?? null,
      sessionPaymentIntent(session),
      session.livemode ? 1 : 0,
      problems.length ? problems.join('; ') : null,
      now,
      now,
      orderId,
    )
    .run()
  return status
}

/** A charge refunded or disputed in Stripe's dashboard: the order follows. */
export async function chargeChanged(db: D1Database, paymentIntent: string, change: 'refunded' | 'partly_refunded' | 'disputed' | 'dispute_won' | 'dispute_lost'): Promise<void> {
  const now = nowIso()
  const status = change === 'refunded' || change === 'dispute_lost' ? 'refunded' : change === 'disputed' ? 'disputed' : change === 'dispute_won' ? 'paid' : null
  if (status) {
    await db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE payment_intent = ? AND status IN ('paid', 'disputed', 'needs_review')").bind(status, now, paymentIntent).run()
  } else {
    await db.prepare("UPDATE orders SET problem = 'partly refunded in Stripe', updated_at = ? WHERE payment_intent = ?").bind(now, paymentIntent).run()
  }
}

/** The sweep's part: open orders a webhook hasn't settled, checked with Stripe (a few a run); old ones expire. */
export async function reconcileOrders(env: DamBindings, limit = 5): Promise<number> {
  const db = env.DB
  const { results } = await db
    .prepare("SELECT id FROM orders WHERE status = 'open' AND session_id IS NOT NULL AND created_at < ? ORDER BY updated_at LIMIT ?")
    .bind(new Date(Date.now() - 5 * 60_000).toISOString(), limit)
    .all<{ id: string }>()
  let checked = 0
  for (const r of results) {
    try {
      await fulfil(env, r.id)
    } catch (error) {
      console.warn('[orders] could not check', r.id, error)
    }
    // Looked at: to the back of the line.
    await db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').bind(nowIso(), r.id).run()
    checked++
  }
  // An order never paid (no session, or a day old and still open) is let go.
  await db.prepare("UPDATE orders SET status = 'expired', updated_at = ? WHERE status = 'open' AND created_at < ?").bind(nowIso(), new Date(Date.now() - 86_400_000).toISOString()).run()
  return checked
}

export interface OrderView {
  id: string
  status: string
  gallery: string
  shareToken: string | null
  currency: string
  total: number | null
  subtotal: number
  email: string | null
  createdAt: string
  paidAt: string | null
  /**
   * label: the real filename, only if the gallery showed filenames when this was bought; otherwise the buyer sees
   * "Photo {n}". filename: for the team only (never in what the buyer's order link returns).
   */
  items: { id: string; label: string | null; n: number | null; filename?: string; size: string; amount: number; refunded: boolean; assetId: string | null }[]
}

async function orderJson(db: D1Database, id: string, team: boolean): Promise<OrderView | null> {
  const order = await db
    .prepare('SELECT id, status, gallery_name, share_token, currency, amount_total, amount_subtotal, email, created_at, paid_at FROM orders WHERE id = ?')
    .bind(id)
    .first<{ id: string; status: string; gallery_name: string; share_token: string | null; currency: string; amount_total: number | null; amount_subtotal: number; email: string | null; created_at: string; paid_at: string | null }>()
  if (!order) return null
  const { results } = await db
    .prepare('SELECT id, filename, n, label, size, unit_amount, refunded_at, asset_id FROM order_items WHERE order_id = ? ORDER BY n, filename')
    .bind(id)
    .all<{ id: string; filename: string; n: number | null; label: string | null; size: string; unit_amount: number; refunded_at: string | null; asset_id: string | null }>()
  return {
    id: order.id,
    status: order.status,
    gallery: order.gallery_name,
    shareToken: order.share_token,
    currency: order.currency,
    total: order.amount_total,
    subtotal: order.amount_subtotal,
    email: order.email,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    items: results.map((r) => ({
      id: r.id,
      label: r.label,
      n: r.n,
      ...(team ? { filename: r.filename } : {}),
      size: r.size,
      amount: r.unit_amount,
      refunded: r.refunded_at !== null,
      assetId: r.asset_id,
    })),
  }
}

/** An order by its link (the key in the address, checked against its hash). */
export async function orderByLink(db: D1Database, id: string, key: string): Promise<OrderView | null> {
  if (!/^[0-9a-f]{32}$/.test(id) || !/^[0-9a-f]{64}$/.test(key)) return null
  const row = await db.prepare('SELECT link_hash FROM orders WHERE id = ?').bind(id).first<{ link_hash: string }>()
  if (!row || row.link_hash !== (await sha256Hex(key))) return null
  return orderJson(db, id, false)
}

/** An order for the team (Orders tab), with each photo's real filename. */
export const getOrder = (db: D1Database, id: string) => orderJson(db, id, true)

/** Orders for the Orders tab, newest first, by status. */
export async function listOrders(db: D1Database, status?: string): Promise<(Omit<OrderView, 'items'> & { name: string | null; photos: number; problem: string | null })[]> {
  const { results } = await db
    .prepare(
      `SELECT o.id, o.status, o.gallery_name, o.share_token, o.currency, o.amount_total, o.amount_subtotal, o.email, o.name, o.problem, o.created_at, o.paid_at,
              (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS photos
       FROM orders o WHERE (?1 IS NULL AND o.status != 'open' AND o.status != 'expired') OR o.status = ?1 ORDER BY o.created_at DESC LIMIT 500`,
    )
    .bind(status ?? null)
    .all<{ id: string; status: string; gallery_name: string; share_token: string | null; currency: string; amount_total: number | null; amount_subtotal: number; email: string | null; name: string | null; problem: string | null; created_at: string; paid_at: string | null; photos: number }>()
  return results.map((r) => ({
    id: r.id,
    status: r.status,
    gallery: r.gallery_name,
    shareToken: r.share_token,
    currency: r.currency,
    total: r.amount_total,
    subtotal: r.amount_subtotal,
    email: r.email,
    name: r.name,
    problem: r.problem,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    photos: r.photos,
  }))
}

/** What a buyer (by their cookie) has bought in a gallery, paid or still being paid: the gallery offers it. */
export async function buyerOrders(db: D1Database, shareId: string, buyer: string): Promise<{ orderId: string; itemId: string; assetId: string; size: string; paid: boolean }[]> {
  const { results } = await db
    .prepare(
      `SELECT o.id AS order_id, o.status, i.id AS item_id, i.asset_id, i.size FROM orders o JOIN order_items i ON i.order_id = o.id
       WHERE o.share_id = ? AND o.buyer = ? AND o.status IN ('paid', 'open') AND i.asset_id IS NOT NULL AND i.refunded_at IS NULL
       ORDER BY o.created_at DESC LIMIT 2000`,
    )
    .bind(shareId, buyer)
    .all<{ order_id: string; status: string; item_id: string; asset_id: string; size: string }>()
  return results.map((r) => ({ orderId: r.order_id, itemId: r.item_id, assetId: r.asset_id, size: r.size, paid: r.status === 'paid' }))
}
