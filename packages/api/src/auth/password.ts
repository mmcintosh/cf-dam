/**
 * Password hashing for Better Auth: PBKDF2-SHA256 through WebCrypto (ported from Infowall).
 *
 * Better Auth's default is scrypt in JavaScript, which costs a lot of Worker CPU per sign-in.
 * PBKDF2 runs natively in the runtime. 100,000 iterations is the ceiling workerd allows.
 * Format: `pbkdf2:<iterations>:<salt hex>:<hash hex>`.
 */
import { timingSafeEqual, toHex } from '../lib/crypto'

const ITERATIONS = 100_000

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256)
  return toHex(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2:${ITERATIONS}:${toHex(salt)}:${await derive(password, salt, ITERATIONS)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationsText, saltHex, expected] = stored.split(':')
  if (scheme !== 'pbkdf2' || !iterationsText || !saltHex || !expected) return false
  const iterations = Number.parseInt(iterationsText, 10)
  const saltBytes = saltHex.match(/.{2}/g)
  if (!Number.isInteger(iterations) || iterations <= 0 || !saltBytes) return false
  const salt = new Uint8Array(saltBytes.map((b) => Number.parseInt(b, 16)))
  return timingSafeEqual(await derive(password, salt, iterations), expected)
}
