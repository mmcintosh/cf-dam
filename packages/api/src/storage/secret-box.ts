/**
 * Encrypt credentials at rest in D1 (AES-256-GCM).
 *
 * The key is derived with HKDF from STORAGE_ENCRYPTION_KEY, or from BETTER_AUTH_SECRET when that is
 * not set, so a one-click install needs no extra secret. Setting STORAGE_ENCRYPTION_KEY separately
 * means rotating the auth secret does not orphan stored storage credentials.
 * Format: `v1.<iv base64url>.<ciphertext base64url>`.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('cf-dam'), info: encoder.encode('storage-credentials v1') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function seal(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext)))
  return `v1.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`
}

export async function open(key: CryptoKey, sealed: string): Promise<string> {
  const [version, iv, ciphertext] = sealed.split('.')
  if (version !== 'v1' || !iv || !ciphertext) throw new Error('Unrecognised sealed value.')
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, key, fromBase64Url(ciphertext))
  return decoder.decode(plaintext)
}

export function storageSecret(env: { STORAGE_ENCRYPTION_KEY?: string; BETTER_AUTH_SECRET?: string }): string {
  const secret = env.STORAGE_ENCRYPTION_KEY ?? env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('Set STORAGE_ENCRYPTION_KEY (or BETTER_AUTH_SECRET) to store storage credentials.')
  return secret
}
