/**
 * Selling's settings (plans/PLAN-SELL-v2.md §3): the photographer's Stripe restricted key and webhook signing secret
 * (sealed, under a key of their own, and left out of backups), the currency (locked once anything is priced or sold),
 * the business name and the terms shown at checkout.
 */
import type { DamBindings } from '../env'
import { nowIso } from '../lib/time'
import { open, seal, storageSecret } from '../storage/secret-box'

export const PAYMENTS_KEY = 'payments'

/** Currencies offered: decimals (minor units) and Stripe's smallest charge, in minor units. */
export const CURRENCIES: Record<string, { decimals: number; minimum: number }> = {
  usd: { decimals: 2, minimum: 50 },
  eur: { decimals: 2, minimum: 50 },
  gbp: { decimals: 2, minimum: 30 },
  cad: { decimals: 2, minimum: 50 },
  aud: { decimals: 2, minimum: 50 },
  chf: { decimals: 2, minimum: 50 },
  nzd: { decimals: 2, minimum: 50 },
  dkk: { decimals: 2, minimum: 250 },
  sek: { decimals: 2, minimum: 300 },
  nok: { decimals: 2, minimum: 300 },
  jpy: { decimals: 0, minimum: 50 },
}

export interface PaymentSettings {
  currency: string
  /** The seller's name, shown on the order page. */
  business: string
  /** Terms and refunds, shown on Stripe's checkout page. */
  terms: string
}

export const DEFAULT_PAYMENTS: PaymentSettings = { currency: 'usd', business: '', terms: '' }

export async function getPaymentSettings(db: D1Database): Promise<PaymentSettings> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(PAYMENTS_KEY).first<{ value: string }>()
  try {
    return { ...DEFAULT_PAYMENTS, ...(row ? (JSON.parse(row.value) as Partial<PaymentSettings>) : {}) }
  } catch {
    return DEFAULT_PAYMENTS
  }
}

export async function savePaymentSettings(db: D1Database, settings: PaymentSettings): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(PAYMENTS_KEY, JSON.stringify(settings), nowIso())
    .run()
}

/** The currency can't change once a price list or an order uses it (amounts would mean something else). */
export async function currencyLocked(db: D1Database): Promise<boolean> {
  const row = await db.prepare('SELECT (SELECT COUNT(*) FROM price_lists) + (SELECT COUNT(*) FROM orders) AS n').first<{ n: number }>()
  return (row?.n ?? 0) > 0
}

async function secretKey(env: Pick<DamBindings, 'STORAGE_ENCRYPTION_KEY' | 'BETTER_AUTH_SECRET'>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(storageSecret(env)), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('cf-dam'), info: new TextEncoder().encode('payment-secrets v1') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export type SecretName = 'stripe_key' | 'stripe_webhook'

export async function setPaymentSecret(env: DamBindings, name: SecretName, value: string | null): Promise<void> {
  if (value === null) {
    await env.DB.prepare('DELETE FROM payment_secrets WHERE name = ?').bind(name).run()
    return
  }
  await env.DB.prepare('INSERT INTO payment_secrets (name, sealed, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at')
    .bind(name, await seal(await secretKey(env), value), nowIso())
    .run()
}

export async function getPaymentSecret(env: DamBindings, name: SecretName): Promise<string | null> {
  const row = await env.DB.prepare('SELECT sealed FROM payment_secrets WHERE name = ?').bind(name).first<{ sealed: string }>()
  if (!row) return null
  try {
    return await open(await secretKey(env), row.sealed)
  } catch {
    return null
  }
}

/** test or live, from the key's prefix (sk_/rk_test_ vs _live_). */
export const keyMode = (key: string | null): 'test' | 'live' | null => (key ? (/_test_/.test(key) ? 'test' : /_live_/.test(key) ? 'live' : null) : null)

/** What the Orders settings show: no secret ever leaves, only whether each is set and the key's last four. */
export async function paymentStatus(env: DamBindings) {
  const [key, webhook, settings, seen] = await Promise.all([
    getPaymentSecret(env, 'stripe_key'),
    getPaymentSecret(env, 'stripe_webhook'),
    getPaymentSettings(env.DB),
    env.DB.prepare('SELECT MAX(created_at) AS at FROM stripe_events').first<{ at: string | null }>(),
  ])
  return {
    configured: Boolean(key && webhook),
    keySet: Boolean(key),
    keyEnds: key ? key.slice(-4) : null,
    webhookSet: Boolean(webhook),
    mode: keyMode(key),
    lastEventAt: seen?.at ?? null,
    currencyLocked: await currencyLocked(env.DB),
    settings,
  }
}
