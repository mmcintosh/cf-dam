/**
 * Sending one message (plans/PLAN-E-v2.md in cf-dam-docs): Cloudflare Email Sending through the `MAIL` binding,
 * added at deploy time only when MAIL_FROM's domain is set up for sending (scripts/optional-bindings.mjs). Tests pass
 * a fake binding. What to do after a failure comes from the binding's error code.
 */
import type { DamBindings } from '../env'

export interface MailMessage {
  to: string
  subject: string
  html: string
  text: string
  /** Display name for the From line (the studio's name). */
  fromName: string
  replyTo?: string
  headers?: Record<string, string>
}

/** The parts of the `send_email` binding we use (the object form of `send`). */
export interface MailBinding {
  send(message: {
    from: string | { email: string; name: string }
    to: string
    subject: string
    html: string
    text: string
    replyTo?: string
    headers?: Record<string, string>
  }): Promise<{ messageId: string }>
}

/** sent; retry later; give up on this message; stop sending altogether (the account or domain is wrong). */
export type SendOutcome = { ok: true; id: string } | { ok: false; code: string; message: string; then: 'retry' | 'tomorrow' | 'give_up' | 'suppressed' | 'stop' }

const STOP = new Set(['E_ACCOUNT_SUSPENDED', 'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_SENDER_NOT_VERIFIED'])
const RETRY = new Set(['E_INTERNAL_SERVER_ERROR', 'E_RATE_LIMIT_EXCEEDED'])

/** Whether this install can send at all: the binding and a sender address. */
export const mailAvailable = (env: Pick<DamBindings, 'MAIL' | 'MAIL_FROM'>): boolean => Boolean(env.MAIL && env.MAIL_FROM)

/** No CR or LF (header injection), and not too long. */
export const headerSafe = (value: string, max = 200): string => value.replace(/[\r\n]+/g, ' ').trim().slice(0, max)

export async function sendMail(env: Pick<DamBindings, 'MAIL' | 'MAIL_FROM'>, message: MailMessage): Promise<SendOutcome> {
  if (!env.MAIL || !env.MAIL_FROM) return { ok: false, code: 'E_NO_MAIL', message: 'Email is not set up.', then: 'stop' }
  try {
    const { messageId } = await env.MAIL.send({
      from: { email: env.MAIL_FROM, name: headerSafe(message.fromName, 80) || 'cf-dam' },
      to: message.to,
      subject: headerSafe(message.subject, 180),
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { replyTo: headerSafe(message.replyTo, 254) } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
    })
    return { ok: true, id: messageId }
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? 'E_UNKNOWN')
    const text = error instanceof Error ? error.message : String(error)
    const then = STOP.has(code)
      ? 'stop'
      : code === 'E_RECIPIENT_SUPPRESSED'
        ? 'suppressed'
        : code === 'E_DAILY_LIMIT_EXCEEDED'
          ? 'tomorrow'
          : RETRY.has(code) || code === 'E_UNKNOWN'
            ? 'retry'
            : 'give_up'
    return { ok: false, code, message: text.slice(0, 300), then }
  }
}

/**
 * Staging's allow list (MAIL_ALLOW_TO: addresses and @domains, comma-separated): staging may hold a copy of real
 * clients, and must never email them. Empty or unset: anyone (production).
 */
export function allowedRecipient(env: Pick<DamBindings, 'MAIL_ALLOW_TO'>, address: string): boolean {
  const list = (env.MAIL_ALLOW_TO ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (list.length === 0) return true
  const to = address.toLowerCase()
  return list.some((entry) => (entry.startsWith('@') ? to.endsWith(entry) : to === entry))
}
