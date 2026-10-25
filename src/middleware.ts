/**
 * Page access. Runs for every Astro page (the API under /api has its own guards).
 *
 *  - No users yet → everything goes to /setup.
 *  - Signed out → /login, remembering where they were headed.
 *  - Someone with setup to do (a temporary password, a second factor) → /account.
 *  - Some pages need a permission (PAGE_PERMISSIONS).
 *  - A client (only the Client role) sees their galleries, Account and their help page, nothing else.
 *  - An invite link (/invite/<token>) opens signed in or not; the page says what to do either way.
 */
import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { clientGalleries, getPreferences, isClientOnly, resolvePrincipal, setupNeeded } from '@cf-dam/api'
import { currentLanguage, LANGUAGE_COOKIE, setLanguage } from '@cf-dam/i18n'

const SIGNED_OUT_PAGES = new Set(['/login', '/forgot-password'])
/** All a client can open (client galleries themselves are under /s/, open to anyone with the link). */
const CLIENT_PAGES = new Set(['/my-galleries', '/account', '/help/for-clients'])

/** Pages that need more than being signed in. First matching prefix wins. */
const PAGE_PERMISSIONS: [string, string][] = [
  ['/admin/activity', 'activity:read'],
  ['/admin/alerts', 'alerts:read'],
  ['/admin', 'users:manage'],
  ['/galleries', 'shares:manage'],
  ['/clients', 'clients:manage'],
  ['/jobs', 'clients:manage'],
  ['/settings/storage', 'sources:manage'],
  ['/settings/ai', 'ai:run'],
  ['/settings/email', 'settings:manage'],
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
  context.locals.preferences = null
  context.locals.lang = currentLanguage()
  // Served by the Hono routes in src/fetch.ts; never gated behind sign-in.
  if (pathname.startsWith('/.well-known/')) return next()
  // Client galleries: the link is the key (packages/api/src/routes/gallery.ts).
  if (pathname.startsWith('/s/')) return next()

  if (await setupNeeded(env.DB)) {
    return pathname === '/setup' ? next() : context.redirect('/setup')
  }
  if (pathname === '/setup') return context.redirect('/login')

  const principal = await resolvePrincipal(env, context.request)
  context.locals.principal = principal

  if (pathname.startsWith('/invite/')) return next()
  // A reset link from an email opens whoever is signed in on this device; the page says what it does.
  if (pathname === '/reset-password') return next()
  // A gallery email's "don't email me" page: its link is the key, signed in or not.
  if (pathname === '/email-off') return next()
  if (!principal) {
    if (SIGNED_OUT_PAGES.has(pathname)) return next()
    return context.redirect(`/login?next=${encodeURIComponent(pathname + search)}`)
  }
  if (SIGNED_OUT_PAGES.has(pathname)) return context.redirect('/')
  // Their own language wins over the browser's; the cookie keeps a copy for the API and next time.
  const preferences = await getPreferences(env.DB, principal.userId)
  context.locals.preferences = preferences
  if (preferences.language !== 'auto') {
    setLanguage(preferences.language)
    context.locals.lang = preferences.language
    if (context.cookies.get(LANGUAGE_COOKIE)?.value !== preferences.language) {
      context.cookies.set(LANGUAGE_COOKIE, preferences.language, { path: '/', maxAge: 31_536_000, sameSite: 'lax', secure: context.url.protocol === 'https:' })
    }
  }
  // A temporary password to replace, or a second factor to set up: Account until it's done.
  if (principal.setup) return pathname === '/account' ? next() : context.redirect('/account')
  if (isClientOnly(principal.roles)) {
    if (CLIENT_PAGES.has(pathname)) return next()
    // Straight into the gallery when there's just one open; otherwise the list.
    if (pathname === '/') {
      const open = (await clientGalleries(env.DB, principal.userId)).filter((g) => !g.expired)
      if (open.length === 1) return context.redirect(`/s/${open[0]!.token}`)
    }
    return context.redirect('/my-galleries')
  }
  const needed = PAGE_PERMISSIONS.find(([prefix]) => pathname.startsWith(prefix))?.[1]
  if (needed && !principal.permissions.has(needed)) {
    return new Response('Forbidden', { status: 403 })
  }
  return next()
})
