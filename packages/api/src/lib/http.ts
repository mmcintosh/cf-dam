import type { Context } from 'hono'

export class BadRequest extends Error {}

/** Parse a JSON object body, or throw BadRequest. */
export async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new BadRequest('Body must be JSON.')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BadRequest('Body must be a JSON object.')
  return body as Record<string, unknown>
}

export function requiredString(body: Record<string, unknown>, field: string, maxLength = 200): string {
  const value = body[field]
  if (typeof value !== 'string' || value.trim() === '') throw new BadRequest(`${field} is required.`)
  if (value.length > maxLength) throw new BadRequest(`${field} is too long.`)
  return value.trim()
}

export function optionalString(body: Record<string, unknown>, field: string, maxLength = 200): string | undefined {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new BadRequest(`${field} must be a string.`)
  if (value.length > maxLength) throw new BadRequest(`${field} is too long.`)
  return value.trim()
}

export function stringArray(body: Record<string, unknown>, field: string): string[] | undefined {
  const value = body[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((v): v is string => typeof v === 'string')) {
    throw new BadRequest(`${field} must be an array of strings.`)
  }
  return [...new Set(value)]
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function requiredEmail(body: Record<string, unknown>, field = 'email'): string {
  const value = requiredString(body, field, 254).toLowerCase()
  if (!EMAIL.test(value)) throw new BadRequest(`${field} is not an email address.`)
  return value
}

export function isLocalRequest(request: Request): boolean {
  const { hostname } = new URL(request.url)
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}
