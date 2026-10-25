/**
 * The few Stripe calls selling needs (plans/PLAN-SELL-v2.md), over fetch: create a Checkout Session, read one back,
 * and check a webhook's signature with Web Crypto. A pinned API version, so the shapes read here don't drift with the
 * photographer's account default. Tests swap `fetch`.
 */
export const STRIPE_API = 'https://api.stripe.com/v1'
export const STRIPE_VERSION = '2024-06-20'

export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Stripe's form encoding: nested objects and arrays as a[b][0][c]=v. */
export function formEncode(params: Record<string, unknown>, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (Array.isArray(value)) value.forEach((v, i) => (typeof v === 'object' && v !== null ? formEncode(v as Record<string, unknown>, `${name}[${i}]`, out) : out.append(`${name}[${i}]`, String(v))))
    else if (typeof value === 'object') formEncode(value as Record<string, unknown>, name, out)
    else out.append(name, String(value))
  }
  return out
}

export async function stripe<T>(key: string, method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
  const body = formEncode(params)
  const url = method === 'GET' && body.size > 0 ? `${STRIPE_API}${path}?${body}` : `${STRIPE_API}${path}`
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Stripe-Version': STRIPE_VERSION,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(method === 'POST' ? { body } : {}),
  })
  const json = (await response.json().catch(() => ({}))) as { error?: { code?: string; type?: string; message?: string } } & T
  if (!response.ok) throw new StripeError(response.status, json.error?.code ?? json.error?.type ?? 'stripe_error', json.error?.message ?? `Stripe answered ${response.status}`)
  return json
}

/** The parts of a Checkout Session read here. */
export interface CheckoutSession {
  id: string
  url: string | null
  status: 'open' | 'complete' | 'expired'
  payment_status: 'paid' | 'unpaid' | 'no_payment_required'
  livemode: boolean
  currency: string
  amount_subtotal: number | null
  amount_total: number | null
  total_details?: { amount_tax?: number; amount_shipping?: number; amount_discount?: number } | null
  client_reference_id: string | null
  payment_intent: string | { id: string } | null
  customer_details?: { email?: string | null; name?: string | null } | null
}

export const sessionPaymentIntent = (s: CheckoutSession) => (typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? null))

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * Whether a webhook body is Stripe's: HMAC-SHA256 of `t.rawBody` with the signing secret, compared in constant time
 * with every v1 signature (several during a secret roll), and no older than the tolerance.
 */
export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSeconds = 300, now = Date.now()): Promise<boolean> {
  if (!header || !secret) return false
  const parts = header.split(',').map((p) => p.trim().split('='))
  const t = parts.find(([k]) => k === 't')?.[1]
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '')
  if (!t || !/^\d+$/.test(t) || signatures.length === 0) return false
  if (Math.abs(now / 1000 - Number(t)) > toleranceSeconds) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`)))
  return signatures.some((sig) => {
    if (sig.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
    return diff === 0
  })
}
