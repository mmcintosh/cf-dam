import { Hono } from 'hono'
import { getPlatformProxy } from 'wrangler'
import { createDamApi, wellKnownRoutes, type DamBindings } from '../src/index'
import { migrate, type Migration } from '../src/db/migrate'
import { resetSetupCacheForTests } from '../src/routes/setup'
import { resetSiteLanguageCache } from '../src/lib/language'

export const ORIGIN = 'http://localhost'
export const ADMIN = { name: 'Ada Admin', email: 'ada@example.com', password: 'correct horse battery staple' }

/**
 * Round trips to D1 so far. A Worker invocation may make 1,000 (Workers Paid) or 50 (Free); a batch
 * is one round trip, but every statement in it is also counted in `statements`.
 */
export interface QueryCount {
  roundTrips: number
  statements: number
}

export interface Harness {
  env: DamBindings
  queries: QueryCount
  /** The round trips (and statements) `run` makes. */
  count(run: () => Promise<unknown>): Promise<QueryCount>
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
  const queries: QueryCount = { roundTrips: 0, statements: 0 }
  const env: DamBindings = {
    DB: counting(proxy.env.DB, queries),
    CACHE_KV: proxy.env.CACHE_KV,
    MEDIA_BUCKET: proxy.env.MEDIA_BUCKET,
    IMAGES: proxy.env.IMAGES,
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-0123456789', // gitleaks:allow (test-only value)
    ...overrides,
  }
  await migrate(env.DB, options.migrations)
  resetSetupCacheForTests()
  resetSiteLanguageCache()

  const app = new Hono().route('/.well-known', wellKnownRoutes).route('/api', createDamApi())
  const pending: Promise<unknown>[] = []
  const executionCtx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    props: {},
  }

  return {
    env,
    queries,
    async count(run) {
      const before = { ...queries }
      await run()
      return { roundTrips: queries.roundTrips - before.roundTrips, statements: queries.statements - before.statements }
    },
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

/** D1 that counts what is sent to it. Statements are wrapped; batch() is given back the real ones. */
function counting(db: D1Database, queries: QueryCount): D1Database {
  const real = new WeakMap<object, D1PreparedStatement>()
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, prop) {
        if (prop === 'bind') return (...values: unknown[]) => wrap(target.bind(...values))
        if (prop === 'run' || prop === 'all' || prop === 'first' || prop === 'raw')
          return (...args: unknown[]) => {
            queries.roundTrips++
            queries.statements++
            return (target[prop] as (...a: unknown[]) => unknown).apply(target, args)
          }
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    real.set(wrapped, statement)
    return wrapped
  }
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql))
      if (prop === 'batch')
        return (statements: D1PreparedStatement[]) => {
          queries.roundTrips++
          queries.statements += statements.length
          return target.batch(statements.map((s) => real.get(s) ?? s))
        }
      if (prop === 'exec')
        return (sql: string) => {
          queries.roundTrips++
          queries.statements++
          return target.exec(sql)
        }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
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

/**
 * Create a person as an admin would, as if they had already replaced the temporary password (which
 * otherwise keeps them on Account: see setup-steps.test.ts). Returns their id.
 */
export async function createUser(h: Harness, adminCookie: string, user: { name: string; email: string; password: string; roles: string[] }): Promise<string> {
  const response = await h.fetch('/api/users', { ...json(user), cookie: adminCookie })
  if (response.status !== 201) throw new Error(`creating ${user.email} failed: ${response.status} ${await response.text()}`)
  const { user: created } = (await response.json()) as { user: { id: string } }
  await h.env.DB.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').bind(created.id).run()
  return created.id
}

export async function signIn(h: Harness, email: string, password: string, ip?: string): Promise<Response> {
  return h.fetch('/api/auth/sign-in/email', { ...json({ email, password }), ip })
}
