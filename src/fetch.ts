import { Hono } from 'hono'
import { cf } from '@astrojs/cloudflare/hono'
import { actions, i18n, middleware, notFound, pages, sessions } from 'astro/hono'
import { browserOrigins, createDamApi, ensureMigrated, handleWork, requestLanguage, runSweep, securityHeaders, wellKnownRoutes, type DamBindings, type WorkMessage } from '@cf-dam/api'
import { runInLanguage } from '@cf-dam/i18n'

// The Worker entry (wrangler `main`). One Worker serves both halves: the JSON API under /api,
// with real env and executionCtx, then Astro for every other path.
const app = new Hono<{ Bindings: Env & DamBindings }>()

// Pages may talk to the S3 buckets configured as connections (presigned uploads and playback), no others.
app.use('*', securityHeaders((c) => browserOrigins(c.env.DB)))

// A Deploy-to-Cloudflare install never runs `wrangler d1 migrations apply`; the first request in
// each isolate brings the schema up to date instead.
app.use('*', async (c, next) => {
  await ensureMigrated(c.env.DB)
  await next()
})

// The request's language (packages/i18n): everything after this, API messages and pages alike, runs in it.
// A signed-in person's own choice can still change it (src/middleware.ts, the API's sign-in check).
app.use('*', async (c, next) => runInLanguage(await requestLanguage(c.env, c.req.raw), next))

// OIDC issuer metadata for keyless AWS access (public keys only).
app.route('/.well-known', wellKnownRoutes)
app.route('/api', createDamApi())
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

app.use(cf())
app.use(sessions())
app.use(notFound())
app.use(actions())
app.use(middleware())
app.use(i18n())
app.use(pages())

export default {
  fetch: app.fetch,
  // Every minute (wrangler.jsonc `triggers`): process imported files and finish restores.
  async scheduled(_controller: ScheduledController, env: Env & DamBindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      ensureMigrated(env.DB)
        .then(() => runSweep(env))
        .then((result) => {
          if (result.processed || result.restored) console.log('[sweep]', JSON.stringify(result))
        }),
    )
  },
  // The fast lane for background work (wrangler.jsonc `queues`): the sweep remains the safety net.
  async queue(batch: MessageBatch<WorkMessage>, env: Env & DamBindings) {
    await ensureMigrated(env.DB)
    await handleWork(env, batch)
  },
} satisfies ExportedHandler<Env & DamBindings, WorkMessage>
