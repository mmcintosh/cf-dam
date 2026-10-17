import { createAuthClient } from 'better-auth/client'
import { twoFactorClient } from 'better-auth/client/plugins'

/** Browser-side Better Auth client for the islands. Same origin, so no baseURL is needed. */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [twoFactorClient()],
})

/** A safe post-login destination: a same-origin path, never an absolute or protocol-relative URL. */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  return raw
}

/** JSON request to our API, throwing the server's message on failure. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as { message?: string; error?: string }
      message = body.message ?? body.error ?? message
    } catch {
      // keep the generic message
    }
    throw new Error(message)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}
