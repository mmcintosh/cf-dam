import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OMITTED_TABLES } from '../src/catalog/backups'
import { reconcileOrders } from '../src/selling/orders'
import { verifyStripeSignature } from '../src/selling/stripe'
import { cookiesFrom, createHarness, createUser, json, setUpAdmin, signIn, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))
const WEBHOOK_SECRET = 'whsec_testsecretvalue0123456789'

/** Just enough of Stripe: sessions made and read back, in whatever state the test sets. */
class FakeStripe {
  created: URLSearchParams[] = []
  sessions = new Map<string, Record<string, unknown>>()
  realFetch = globalThis.fetch
  handle = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.hostname !== 'api.stripe.com') return this.realFetch(input as Request, init)
    const method = init?.method ?? 'GET'
    if (method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const params = new URLSearchParams(String(init!.body))
      this.created.push(params)
      const id = `cs_test_${this.created.length}`
      const session = {
        id,
        url: `https://checkout.stripe.com/c/pay/${id}`,
        status: 'open',
        payment_status: 'unpaid',
        livemode: false,
        currency: params.get('line_items[0][price_data][currency]'),
        amount_subtotal: Number(params.get('line_items[0][price_data][unit_amount]')),
        amount_total: Number(params.get('line_items[0][price_data][unit_amount]')),
        total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
        client_reference_id: params.get('client_reference_id'),
        payment_intent: null,
        customer_details: null,
      }
      this.sessions.set(id, session)
      return Response.json(session)
    }
    if (method === 'GET' && url.pathname === '/v1/checkout/sessions') return Response.json({ data: [] })
    const m = /^\/v1\/checkout\/sessions\/(cs_test_\d+)$/.exec(url.pathname)
    if (m && this.sessions.has(m[1]!)) return Response.json(this.sessions.get(m[1]!))
    return Response.json({ error: { message: 'not found' } }, { status: 404 })
  }
  pay(id: string, extra: Record<string, unknown> = {}) {
    Object.assign(this.sessions.get(id)!, { status: 'complete', payment_status: 'paid', payment_intent: `pi_${id}`, customer_details: { email: 'buyer@example.com', name: 'Bea Buyer' }, ...extra })
  }
}

let h: Harness
let admin: string
let fake: FakeStripe
let ids: string[]
let share: { id: string; token: string }

async function upload(filename: string): Promise<string> {
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

async function signed(event: Record<string, unknown>, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))].map((b) => b.toString(16).padStart(2, '0')).join('')
  return h.fetch('/api/public/stripe/webhook', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` } })
}

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  fake = new FakeStripe()
  vi.stubGlobal('fetch', fake.handle)
  ids = [await upload('a.jpg'), await upload('b.jpg')]
  const album = ((await (await h.fetch('/api/albums', { ...json({ name: 'Wedding' }), cookie: admin })).json()) as { album: { id: string } }).album.id
  await h.fetch(`/api/albums/${album}/items`, { ...json({ assetIds: ids }), cookie: admin })
  share = ((await (await h.fetch('/api/shares', { ...json({ albumId: album, name: 'For the Smiths', title: 'Your wedding' }), cookie: admin })).json()) as { share: { id: string; token: string } }).share
  expect((await h.fetch('/api/payments/keys', { method: 'PUT', body: JSON.stringify({ stripeKey: 'rk_test_abcdefghijklmnop', webhookSecret: WEBHOOK_SECRET }), cookie: admin })).status).toBe(200) // gitleaks:allow (made-up test key)
  const list = ((await (await h.fetch('/api/payments/price-lists', { ...json({ name: 'Standard', small: 500, large: 1500, full: 3000, all: 20000 }), cookie: admin })).json()) as { priceList: { id: string } }).priceList
  expect((await h.fetch(`/api/payments/galleries/${share.id}`, { method: 'PUT', body: JSON.stringify({ priceListId: list.id }), cookie: admin })).status).toBe(200)
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await h?.dispose()
})

const gallery = async (cookie?: string) => (await (await h.fetch(`/api/public/galleries/${share.token}`, cookie ? { cookie } : {})).json()) as { store: { currency: string; prices: Record<string, number | null> } | null; purchases: { orderId: string; itemId: string; assetId: string; size: string; paid: boolean }[] }
const checkout = (body: Record<string, unknown>, cookie?: string) => h.fetch(`/api/public/galleries/${share.token}/checkout`, { ...json(body), ...(cookie ? { cookie } : {}) })

describe('paid digital downloads (plans/PLAN-SELL-v2.md S1)', () => {
  it('sells a photo at the price list’s price, and unlocks it only once Stripe says it’s paid', async () => {
    expect((await gallery()).store).toEqual({ currency: 'usd', prices: { small: 500, large: 1500, full: 3000, all: 20000 } })
    const res = await checkout({ assetId: ids[0], size: 'large', amount: 1 })
    expect(res.status).toBe(200)
    const buyer = cookiesFrom(res)
    const { url, orderId } = (await res.json()) as { url: string; orderId: string }
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
    // The price came from the price list, not the browser.
    expect(fake.created[0]!.get('line_items[0][price_data][unit_amount]')).toBe('1500')
    expect(fake.created[0]!.get('client_reference_id')).toBe(orderId)
    const link = new URL(fake.created[0]!.get('success_url')!)
    const k = link.searchParams.get('k')!

    // Not paid yet: nothing to download.
    expect(((await (await h.fetch(`/api/public/orders/${orderId}?k=${k}`)).json()) as { order: { status: string } }).order.status).toBe('open')
    expect((await h.fetch(`/api/public/orders/${orderId}?k=${'0'.repeat(64)}`)).status).toBe(404)

    // An unsigned webhook is refused; a signed one makes it paid by reading the session from Stripe.
    fake.pay('cs_test_1')
    expect((await h.fetch('/api/public/stripe/webhook', { method: 'POST', body: JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed', data: { object: { object: 'checkout.session', id: 'cs_test_1' } } }), headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=bad' } })).status).toBe(400)
    expect((await signed({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { object: 'checkout.session', id: 'cs_test_1' } } })).status).toBe(200)
    const order = ((await (await h.fetch(`/api/public/orders/${orderId}?k=${k}`)).json()) as { order: { status: string; email: string; items: { id: string }[] } }).order
    expect(order).toMatchObject({ status: 'paid', email: 'buyer@example.com' })
    expect((await gallery(buyer)).purchases).toEqual([{ orderId, itemId: order.items[0]!.id, assetId: ids[0], size: 'large', paid: true }])
    // Another browser (no buyer cookie) sees nothing bought.
    expect((await gallery()).purchases).toEqual([])
    // The same event again changes nothing.
    expect((await signed({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { object: 'checkout.session', id: 'cs_test_1' } } })).status).toBe(200)

    // A refund in Stripe's dashboard takes the download away.
    await signed({ id: 'evt_2', type: 'charge.refunded', data: { object: { object: 'charge', payment_intent: 'pi_cs_test_1', refunded: true } } })
    expect((await h.fetch(`/api/public/orders/${orderId}/items/${order.items[0]!.id}?k=${k}`)).status).toBe(403)
  })

  it('pays without a webhook too: the order page and the sweep ask Stripe', async () => {
    const { orderId } = (await (await checkout({ assetId: ids[1], size: 'small' })).json()) as { orderId: string }
    const k = new URL(fake.created[0]!.get('success_url')!).searchParams.get('k')!
    fake.pay('cs_test_1')
    expect(((await (await h.fetch(`/api/public/orders/${orderId}?k=${k}`)).json()) as { order: { status: string } }).order.status).toBe('paid')

    const second = (await (await checkout({ assetId: ids[1], size: 'large' })).json()) as { orderId: string }
    fake.pay('cs_test_2')
    // Ten minutes on with no webhook: the sweep asks Stripe.
    await h.env.DB.prepare('UPDATE orders SET created_at = ? WHERE id = ?').bind(new Date(Date.now() - 10 * 60_000).toISOString(), second.orderId).run()
    expect(await reconcileOrders(h.env)).toBe(1)
    expect(await h.env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(second.orderId).first()).toEqual({ status: 'paid' })
  })

  it('holds an order whose paid amount doesn’t match for a person to look at', async () => {
    const { orderId } = (await (await checkout({ assetId: ids[0], size: 'full' })).json()) as { orderId: string }
    fake.pay('cs_test_1', { amount_subtotal: 100, amount_total: 100 })
    await signed({ id: 'evt_9', type: 'checkout.session.completed', data: { object: { object: 'checkout.session', id: 'cs_test_1' } } })
    expect(await h.env.DB.prepare('SELECT status, problem FROM orders WHERE id = ?').bind(orderId).first()).toMatchObject({ status: 'needs_review', problem: expect.stringContaining('subtotal 100') })
  })

  it('sells the whole gallery for one price, and nothing without a price list', async () => {
    const res = (await (await checkout({ all: true })).json()) as { orderId: string }
    expect(fake.created[0]!.get('line_items[0][price_data][unit_amount]')).toBe('20000')
    expect((await h.env.DB.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?').bind(res.orderId).first())).toEqual({ n: 2 })
    await h.fetch(`/api/payments/galleries/${share.id}`, { method: 'PUT', body: JSON.stringify({ priceListId: null }), cookie: admin })
    expect((await gallery()).store).toBeNull()
    expect((await checkout({ assetId: ids[0], size: 'small' })).status).toBe(400)
  })

  it('keeps payments to administrators, and its secrets out of backups and answers', async () => {
    await createUser(h, admin, { name: 'Eddie Editor', email: 'eddie@example.com', password: 'an editor password', roles: ['editor'] })
    const editor = cookiesFrom(await signIn(h, 'eddie@example.com', 'an editor password'))
    expect((await h.fetch('/api/payments', { cookie: editor })).status).toBe(403)
    expect((await h.fetch('/api/payments/orders', { cookie: editor })).status).toBe(403)
    const status = await (await h.fetch('/api/payments', { cookie: admin })).text()
    expect(status).not.toContain('abcdefghijklmnop')
    expect(status).toContain('"mode":"test"')
    expect(OMITTED_TABLES).toHaveProperty('payment_secrets')
    expect(await h.env.DB.prepare('SELECT sealed FROM payment_secrets').all<{ sealed: string }>().then((r) => r.results.every((x) => !x.sealed.includes('whsec_')))).toBe(true)
  })

  it('checks Stripe signatures exactly', async () => {
    const body = '{"id":"evt"}'
    const t = Math.floor(Date.now() / 1000)
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(await verifyStripeSignature(body, `t=${t},v1=bad,v1=${sig}`, WEBHOOK_SECRET)).toBe(true)
    expect(await verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, WEBHOOK_SECRET)).toBe(false)
    expect(await verifyStripeSignature(body, `t=${t - 600},v1=${sig}`, WEBHOOK_SECRET)).toBe(false)
  })
})
