/**
 * The language of a request (packages/i18n/src/resolve.ts has the order). The archive's language lives in
 * `settings` (`site.language`, chosen at setup); it's read at most once a minute per isolate, so working out a
 * request's language costs no database read. A signed-in person's own choice is copied into the
 * `cfdam_lang` cookie when they save it, and pages put it right if the cookie is missing (src/middleware.ts).
 */
import { asLanguage, LANGUAGE_COOKIE, resolveLanguage, type Language, type UiLanguage } from '@cf-dam/i18n'
import type { DamBindings } from '../env'
import { nowIso } from './time'

export const SITE_LANGUAGE_KEY = 'site.language'
export const TIME_ZONE_COOKIE = 'cfdam_tz'
const SITE_TTL_MS = 60_000

let site: { value: Language | null; at: number } | null = null

export async function siteLanguage(db: D1Database): Promise<Language | null> {
  if (site && Date.now() - site.at < SITE_TTL_MS) return site.value
  let value: Language | null = null
  try {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(SITE_LANGUAGE_KEY).first<{ value: string }>()
    value = (asLanguage(row?.value) as Language | null) ?? null
  } catch {
    // No settings table yet (a brand-new database mid-migration): English.
  }
  site = { value, at: Date.now() }
  return value
}

export async function setSiteLanguage(db: D1Database, lang: Language): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(SITE_LANGUAGE_KEY, lang, nowIso())
    .run()
  site = { value: lang, at: Date.now() }
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim())
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

export const pseudoAllowed = (env: Pick<DamBindings, 'I18N_PSEUDO'>) => env.I18N_PSEUDO === '1'

/** Everything about a request's language that needs no signed-in person. */
export async function requestLanguage(env: DamBindings, request: Request, gallery?: string | null): Promise<{ lang: UiLanguage; timeZone?: string }> {
  const lang = resolveLanguage({
    cookie: readCookie(request, LANGUAGE_COOKIE),
    gallery,
    acceptLanguage: request.headers.get('Accept-Language'),
    site: await siteLanguage(env.DB),
    pseudo: pseudoAllowed(env),
  })
  const zone = readCookie(request, TIME_ZONE_COOKIE)
  // A zone name only (Area/Place), never anything that could carry markup.
  const timeZone = zone && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(zone) ? zone : undefined
  return timeZone ? { lang, timeZone } : { lang }
}

/** The Set-Cookie value that remembers a language choice for a year (or forgets it, for 'auto'). */
export function languageCookie(request: Request, lang: UiLanguage | 'auto'): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return lang === 'auto'
    ? `${LANGUAGE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
    : `${LANGUAGE_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
}
