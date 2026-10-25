/**
 * Selling, for the team (plans/PLAN-SELL-v2.md): connecting Stripe and the settings (`payments:setup`), price lists
 * and which gallery sells what (`payments:setup`), and the orders (`orders:read`).
 */
import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject } from '../lib/http'
import { getOrder, getPriceList, listOrders, listPriceLists, parsePriceList, savePriceList } from '../selling/orders'
import { CURRENCIES, currencyLocked, getPaymentSecret, getPaymentSettings, paymentStatus, savePaymentSettings, setPaymentSecret } from '../selling/settings'
import { stripe, StripeError } from '../selling/stripe'

export const paymentRoutes = new Hono<DamEnv>()

const invalid = (error: unknown) => {
  if (error instanceof BadRequest) return { error: 'invalid_request', message: error.message }
  throw error
}
const ip = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header('cf-connecting-ip')

paymentRoutes.get('/', requirePermission('payments:setup'), async (c) => c.json({ ...(await paymentStatus(c.env)), currencies: Object.keys(CURRENCIES), webhookPath: '/api/public/stripe/webhook' }))

paymentRoutes.put('/', requirePermission('payments:setup'), async (c) => {
  try {
    const body = await readJsonObject(c)
    const settings = await getPaymentSettings(c.env.DB)
    if (body.currency !== undefined) {
      const currency = String(body.currency).toLowerCase()
      if (!(currency in CURRENCIES)) throw new BadRequest(`currency is one of ${Object.keys(CURRENCIES).join(', ')}.`)
      if (currency !== settings.currency && (await currencyLocked(c.env.DB))) throw new BadRequest('The currency can’t change once prices or orders use it.')
      settings.currency = currency
    }
    if (body.business !== undefined) settings.business = String(body.business).slice(0, 200).trim()
    if (body.terms !== undefined) settings.terms = String(body.terms).slice(0, 1000).trim()
    await savePaymentSettings(c.env.DB, settings)
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'payments.settings_changed', ipAddress: ip(c) })
    return c.json(await paymentStatus(c.env))
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

/** The Stripe key and webhook secret: set or replace (never shown again), or remove with null. */
paymentRoutes.put('/keys', requirePermission('payments:setup'), async (c) => {
  try {
    const body = await readJsonObject(c)
    if (body.stripeKey !== undefined) {
      const key = body.stripeKey === null ? null : String(body.stripeKey).trim()
      if (key !== null && !/^(rk|sk)_(test|live)_[A-Za-z0-9]{10,}$/.test(key)) throw new BadRequest('That isn’t a Stripe secret or restricted key (rk_… or sk_…).')
      await setPaymentSecret(c.env, 'stripe_key', key)
    }
    if (body.webhookSecret !== undefined) {
      const secret = body.webhookSecret === null ? null : String(body.webhookSecret).trim()
      if (secret !== null && !/^whsec_[A-Za-z0-9]{10,}$/.test(secret)) throw new BadRequest('That isn’t a webhook signing secret (whsec_…).')
      await setPaymentSecret(c.env, 'stripe_webhook', secret)
    }
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'payments.keys_changed', ipAddress: ip(c) })
    return c.json(await paymentStatus(c.env))
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

/** Check the key works with what selling needs (reading Checkout Sessions). */
paymentRoutes.post('/check', requirePermission('payments:setup'), async (c) => {
  const key = await getPaymentSecret(c.env, 'stripe_key')
  if (!key) return c.json({ ok: false, message: 'No Stripe key yet.' }, 409)
  try {
    await stripe(key, 'GET', '/checkout/sessions', { limit: 1 })
    return c.json({ ok: true })
  } catch (error) {
    if (error instanceof StripeError) return c.json({ ok: false, message: error.message, code: error.code }, 502)
    throw error
  }
})

paymentRoutes.get('/price-lists', requirePermission('payments:setup'), async (c) => c.json({ priceLists: await listPriceLists(c.env.DB), currency: (await getPaymentSettings(c.env.DB)).currency }))

paymentRoutes.post('/price-lists', requirePermission('payments:setup'), async (c) => {
  try {
    const list = parsePriceList(await readJsonObject(c), (await getPaymentSettings(c.env.DB)).currency)
    const id = await savePriceList(c.env.DB, null, list)
    return c.json({ priceList: await getPriceList(c.env.DB, id) }, 201)
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

paymentRoutes.put('/price-lists/:id', requirePermission('payments:setup'), async (c) => {
  try {
    const list = parsePriceList(await readJsonObject(c), (await getPaymentSettings(c.env.DB)).currency)
    const id = await savePriceList(c.env.DB, c.req.param('id'), list)
    return c.json({ priceList: await getPriceList(c.env.DB, id) })
  } catch (error) {
    return c.json(invalid(error), 400)
  }
})

paymentRoutes.delete('/price-lists/:id', requirePermission('payments:setup'), async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM price_lists WHERE id = ?').bind(c.req.param('id')).run()
  return result.meta.changes > 0 ? c.body(null, 204) : c.json({ error: 'not_found' }, 404)
})

/** Which price list a gallery sells with (null: sells nothing). */
paymentRoutes.put('/galleries/:shareId', requirePermission('payments:setup'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { priceListId?: unknown }
  const priceListId = typeof body.priceListId === 'string' && body.priceListId ? body.priceListId : null
  if (priceListId && !(await getPriceList(c.env.DB, priceListId))) return c.json({ error: 'not_found', message: 'No such price list.' }, 404)
  const result = await c.env.DB.prepare('UPDATE shares SET price_list_id = ? WHERE id = ?').bind(priceListId, c.req.param('shareId')).run()
  if (result.meta.changes !== 1) return c.json({ error: 'not_found' }, 404)
  await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'share.price_list', targetType: 'share', targetId: c.req.param('shareId'), details: { selling: priceListId !== null }, ipAddress: ip(c) })
  return c.json({ priceListId })
})

paymentRoutes.get('/galleries/:shareId', requirePermission('payments:setup'), async (c) => {
  const row = await c.env.DB.prepare('SELECT price_list_id FROM shares WHERE id = ?').bind(c.req.param('shareId')).first<{ price_list_id: string | null }>()
  return row ? c.json({ priceListId: row.price_list_id }) : c.json({ error: 'not_found' }, 404)
})

paymentRoutes.get('/orders', requirePermission('orders:read'), async (c) => {
  const status = c.req.query('status')
  return c.json({ orders: await listOrders(c.env.DB, status && /^[a-z_]{3,20}$/.test(status) ? status : undefined) })
})

paymentRoutes.get('/orders/:id', requirePermission('orders:read'), async (c) => {
  const order = await getOrder(c.env.DB, c.req.param('id'))
  return order ? c.json({ order }) : c.json({ error: 'not_found' }, 404)
})
