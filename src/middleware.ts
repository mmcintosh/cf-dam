/**
 * Page access. Runs for every Astro page (the API under /api has its own guards).
 *
 *  - No users yet → everything goes to /setup.
 *  - Signed out → /login, remembering where they were headed.
 *  - Some pages need a permission (PAGE_PERMISSIONS).
 */
import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { resolvePrincipal, setupNeeded } from '@cf-dam/api'

const SIGNED_OUT_PAGES = new Set(['/login'])

/** Pages that need more than being signed in. First matching prefix wins. */
const PAGE_PERMISSIONS: [string, string][] = [
  ['/admin', 'users:manage'],
  ['/settings/storage', 'sources:manage'],
  ['/settings/ai', 'ai:run'],
  ['/sources', 'sources:manage'],
  ['/albums', 'assets:read'],
  ['/assets', 'assets:read'],
  ['/map', 'assets:read'],
  ['/duplicates', 'assets:read'],
  ['/keywords', 'assets:read'],
  ['/presets', 'assets:read'],
]

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url
  context.locals.principal = null
  // Served by the Hono routes in src/fetch.ts; never gated behind sign-in.
  if (pathname.startsWith('/.well-known/')) return next()

  if (await setupNeeded(env.DB)) {
    return pathname === '/setup' ? next() : context.redirect('/setup')
  }
  if (pathname === '/setup') return context.redirect('/login')

  const principal = await resolvePrincipal(env, context.request)
  context.locals.principal = principal

  if (!principal) {
    if (SIGNED_OUT_PAGES.has(pathname)) return next()
    return context.redirect(`/login?next=${encodeURIComponent(pathname + search)}`)
  }
  if (SIGNED_OUT_PAGES.has(pathname)) return context.redirect('/')
  const needed = PAGE_PERMISSIONS.find(([prefix]) => pathname.startsWith(prefix))?.[1]
  if (needed && !principal.permissions.has(needed)) {
    return new Response('Forbidden', { status: 403 })
  }
  return next()
})
