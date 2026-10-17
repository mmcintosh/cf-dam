import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { createAuth } from './auth/auth'
import { authenticate } from './auth/principal'
import { authRateLimitRule, consumeRateLimit } from './auth/rate-limit'
import type { DamEnv } from './env'
import { albumRoutes, tagRoutes } from './routes/albums'
import { assetRoutes } from './routes/assets'
import { connectionRoutes } from './routes/connections'
import { meRoutes } from './routes/me'
import { setupRoutes } from './routes/setup'
import { uploadRoutes } from './routes/uploads'
import { roleRoutes, userRoutes } from './routes/users'

export type { DamBindings, DamEnv } from './env'
export { ensureMigrated, migrate } from './db/migrate'
export { createAuth } from './auth/auth'
export { resolvePrincipal, principalJson, type Principal } from './auth/principal'
export { setupNeeded } from './routes/setup'
export { runSweep, type SweepResult } from './catalog/sweeper'
export { securityHeaders } from './lib/security-headers'
export { wellKnownRoutes } from './routes/well-known'

export const API_VERSION = '0.1.0'

/** The DAM's JSON API, mounted by the app Worker at `/api`. */
export function createDamApi() {
  const api = new Hono<DamEnv>()

  // Cookie-authenticated form posts from another origin are refused. JSON requests can't be sent
  // cross-origin without a CORS preflight, which this API never grants.
  api.use('*', csrf())

  api.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'cf-dam',
      version: API_VERSION,
      bindings: {
        db: c.env?.DB !== undefined,
        mediaBucket: c.env?.MEDIA_BUCKET !== undefined,
      },
    }),
  )

  // Better Auth's endpoints, metered by our limiter first.
  api.on(['GET', 'POST'], '/auth/*', async (c) => {
    const rule = authRateLimitRule(c.req.path)
    if (rule) {
      const limited = await consumeRateLimit(c, rule)
      if (limited) return limited
    }
    return createAuth(c.env, c.req.raw).handler(c.req.raw)
  })

  api.route('/setup', setupRoutes)

  api.use('*', authenticate())
  api.route('/me', meRoutes)
  api.route('/users', userRoutes)
  api.route('/roles', roleRoutes)
  api.route('/connections', connectionRoutes)
  api.route('/uploads', uploadRoutes)
  api.route('/assets', assetRoutes)
  api.route('/albums', albumRoutes)
  api.route('/tags', tagRoutes)

  api.onError((error, c) => {
    // Middleware such as csrf() rejects by throwing; keep its status instead of turning it into a 500.
    if (error instanceof HTTPException) return error.getResponse()
    console.error('[api] unhandled error', error)
    return c.json({ error: 'internal_error' }, 500)
  })

  return api
}

// Server-side reads for the Astro pages (permissions are checked by the page middleware).
export { assetJson, getAsset, getLocations, getTags, listAssets, type AssetJson, type ListFilters } from './catalog/assets'
export { listConnections, type Connection } from './storage/connections'
export { ARCHIVE_CLASSES, S3_STORAGE_CLASSES, RESTORE_TIERS } from './storage/types'
