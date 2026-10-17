/**
 * Page access. Runs for every Astro page (the API under /api has its own guards).
 *
 *  - No users yet → everything goes to /setup.
 *  - Signed out → /login, remembering where they were headed.
 *  - /admin/* needs `users:manage`.
 */
import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { resolvePrincipal, setupNeeded } from '@cf-dam/api'

const SIGNED_OUT_PAGES = new Set(['/login'])

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url
  context.locals.principal = null

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
  if (pathname.startsWith('/admin') && !principal.permissions.has('users:manage')) {
    return new Response('Forbidden', { status: 403 })
  }
  return next()
})
