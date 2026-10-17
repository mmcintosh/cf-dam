import type { MiddlewareHandler } from 'hono'

/**
 * Security headers for every response, API and pages alike.
 *
 * Images may also come from OpenStreetMap's tile server, for the map page.
 * Scripts allow 'unsafe-inline' for now because Astro's island hydration uses inline scripts;
 * tightening that to hashes (Astro's CSP support) is tracked for the library UI. Everything else
 * is strict: no framing, no plugins, no foreign origins.
 */
export const securityHeaders = (): MiddlewareHandler => async (c, next) => {
  await next()
  const headers = c.res.headers
  const set = (name: string, value: string) => {
    if (!headers.has(name)) headers.set(name, value)
  }
  set('X-Content-Type-Options', 'nosniff')
  set('X-Frame-Options', 'DENY')
  set('Referrer-Policy', 'strict-origin-when-cross-origin')
  set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()')
  // connect-src and media-src allow https: because originals live in S3-compatible buckets at whatever
  // endpoint a connection names: the browser PUTs upload parts to presigned bucket URLs, and plays
  // videos from presigned GETs. blob: lets the uploader read a local video to make its poster.
  set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; media-src 'self' blob: https:; font-src 'self'; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  )
  if (new URL(c.req.url).protocol === 'https:') {
    set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}
