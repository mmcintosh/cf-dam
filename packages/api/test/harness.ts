import { Hono } from 'hono'
import { getPlatformProxy } from 'wrangler'
import { createDamApi, wellKnownRoutes, type DamBindings } from '../src/index'
import { migrate, type Migration } from '../src/db/migrate'
import { resetSetupCacheForTests } from '../src/routes/setup'

export const ORIGIN = 'http://localhost'
export const ADMIN = { name: 'Ada Admin', email: 'ada@example.com', password: 'correct horse battery staple' }

export interface Harness {
  env: DamBindings
  /** Send a request to the Worker's /api, carrying `cookie` if given. */
  fetch(path: string, init?: RequestInit & { cookie?: string; ip?: string }): Promise<Response>
  dispose(): Promise<void>
}

export async function createHarness(overrides: Partial<DamBindings> = {}, options: { migrations?: Migration[] } = {}): Promise<Harness> {
  // In-memory D1 and KV, fresh for every harness.
  const proxy = await getPlatformProxy<{ DB: D1Database; CACHE_KV: KVNamespace; MEDIA_BUCKET: R2Bucket; IMAGES: ImagesBinding }>({
    configPath: decodeURIComponent(new URL('./wrangler.test.jsonc', import.meta.url).pathname),
    persist: false,
    envFiles: [],
    remoteBindings: false,
  })
  const env: DamBindings = {
    DB: proxy.env.DB,
    CACHE_KV: proxy.env.CACHE_KV,
    MEDIA_BUCKET: proxy.env.MEDIA_BUCKET,
    IMAGES: proxy.env.IMAGES,
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-0123456789', // gitleaks:allow (test-only value)
    ...overrides,
  }
  await migrate(env.DB, options.migrations)
  resetSetupCacheForTests()

  const app = new Hono().route('/.well-known', wellKnownRoutes).route('/api', createDamApi())
  const pending: Promise<unknown>[] = []
  const executionCtx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    props: {},
  }

  return {
    env,
    async fetch(path, init = {}) {
      const { cookie, ip, ...rest } = init
      const headers = new Headers(rest.headers)
      if (cookie) headers.set('Cookie', cookie)
      if (ip) headers.set('cf-connecting-ip', ip)
      if (rest.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      if (rest.body instanceof Uint8Array || rest.body instanceof ArrayBuffer) headers.set('Content-Length', String(rest.body.byteLength))
      if (!headers.has('Origin') && rest.method && rest.method !== 'GET') headers.set('Origin', ORIGIN)
      const response = await app.request(`${ORIGIN}${path}`, { ...rest, headers }, env, executionCtx)
      await Promise.all(pending.splice(0))
      return response
    },
    async dispose() {
      await proxy.dispose()
    },
  }
}

/** The `name=value` pairs from a response's Set-Cookie headers, joined for a Cookie header. */
export function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

export const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) })

/** Run first-run setup on localhost and return the admin's session cookie. */
export async function setUpAdmin(h: Harness): Promise<string> {
  const response = await h.fetch('/api/setup', json(ADMIN))
  if (!response.ok) throw new Error(`setup failed: ${response.status} ${await response.text()}`)
  return cookiesFrom(response)
}

export async function signIn(h: Harness, email: string, password: string, ip?: string): Promise<Response> {
  return h.fetch('/api/auth/sign-in/email', { ...json({ email, password }), ip })
}
