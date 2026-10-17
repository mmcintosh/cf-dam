import { Hono } from 'hono'
import { cf } from '@astrojs/cloudflare/hono'
import { actions, i18n, middleware, notFound, pages, sessions } from 'astro/hono'
import { createDamApi } from '@cf-dam/api'

// The Worker entry (wrangler `main`). One Worker serves both halves: the JSON API under /api,
// with real env and executionCtx, then Astro for every other path.
const app = new Hono<{ Bindings: Env }>()

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
