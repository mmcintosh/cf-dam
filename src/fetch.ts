import { Hono } from 'hono'
import { cf } from '@astrojs/cloudflare/hono'
import { actions, i18n, middleware, notFound, pages, sessions } from 'astro/hono'
import { createDamApi, ensureMigrated, securityHeaders, type DamBindings } from '@cf-dam/api'

// The Worker entry (wrangler `main`). One Worker serves both halves: the JSON API under /api,
// with real env and executionCtx, then Astro for every other path.
const app = new Hono<{ Bindings: Env & DamBindings }>()

app.use('*', securityHeaders())

// A Deploy-to-Cloudflare install never runs `wrangler d1 migrations apply`; the first request in
// each isolate brings the schema up to date instead.
app.use('*', async (c, next) => {
  await ensureMigrated(c.env.DB)
  await next()
})

app.route('/api', createDamApi())
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

app.use(cf())
app.use(sessions())
app.use(notFound())
app.use(actions())
app.use(middleware())
app.use(i18n())
app.use(pages())

export default app
