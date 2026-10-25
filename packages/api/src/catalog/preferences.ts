/**
 * Each person's appearance choices, kept in the catalog so they follow them to any computer. Pages
 * read them as they're built (no flash of the wrong theme) and put them on <html> as data attributes
 * the stylesheet answers (src/styles/global.css).
 *
 * The accessibility choices are the ones WCAG 2.2 and Section 508 ask a site to make possible: text
 * that can be enlarged without breaking the page (1.4.4), stronger contrast (1.4.6), no motion when
 * asked (2.3.3), visible links (1.4.1) and a font chosen for low vision.
 */
import { asLanguage, type Language } from '@cf-dam/i18n'
import { nowIso } from '../lib/time'

export const THEMES = ['system', 'light', 'dark'] as const
export const TEXT_SIZES = [100, 112, 125, 150] as const
export const THUMBNAIL_SIZES = ['small', 'medium', 'large'] as const

export interface Preferences {
  theme: (typeof THEMES)[number]
  /** Percent of the normal text size. */
  textSize: (typeof TEXT_SIZES)[number]
  highContrast: boolean
  /** Turn off animations and transitions whatever the system says. */
  reduceMotion: boolean
  /** Atkinson Hyperlegible, designed by the Braille Institute for low vision. */
  readableFont: boolean
  underlineLinks: boolean
  thumbnails: (typeof THUMBNAIL_SIZES)[number]
  /** The language cf-dam speaks to them; 'auto' follows their browser (then the archive's language). */
  language: Language | 'auto'
  /** For those who see alerts: an email when something new needs attention (mail/alert-mail.ts). */
  alertEmails: boolean
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  textSize: 100,
  highContrast: false,
  reduceMotion: false,
  readableFont: false,
  underlineLinks: false,
  thumbnails: 'medium',
  language: 'auto',
  alertEmails: true,
}

const one = <T>(allowed: readonly T[], value: unknown, fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

/** A full set of choices from anything: unknown or bad values fall back to `base`. */
export function parsePreferences(value: unknown, base: Preferences = DEFAULT_PREFERENCES): Preferences {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    theme: one(THEMES, v.theme, base.theme),
    textSize: one(TEXT_SIZES, v.textSize, base.textSize),
    highContrast: flag(v.highContrast, base.highContrast),
    reduceMotion: flag(v.reduceMotion, base.reduceMotion),
    readableFont: flag(v.readableFont, base.readableFont),
    underlineLinks: flag(v.underlineLinks, base.underlineLinks),
    thumbnails: one(THUMBNAIL_SIZES, v.thumbnails, base.thumbnails),
    language: v.language === 'auto' ? 'auto' : ((asLanguage(v.language) as Language | null) ?? base.language),
    alertEmails: flag(v.alertEmails, base.alertEmails),
  }
}

export async function getPreferences(db: D1Database, userId: string): Promise<Preferences> {
  const row = await db.prepare('SELECT value FROM user_preferences WHERE user_id = ?').bind(userId).first<{ value: string }>()
  try {
    return parsePreferences(row ? JSON.parse(row.value) : {})
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

/** Change some choices (the rest stay); returns them all. */
export async function savePreferences(db: D1Database, userId: string, patch: unknown): Promise<Preferences> {
  const next = parsePreferences(patch, await getPreferences(db, userId))
  await db
    .prepare(
      `INSERT INTO user_preferences (user_id, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(userId, JSON.stringify(next), nowIso())
    .run()
  return next
}

/** The <html> attributes that carry them (see global.css). */
export function preferenceAttributes(p: Preferences): Record<string, string | undefined> {
  return {
    'data-theme': p.theme === 'system' ? undefined : p.theme,
    'data-contrast': p.highContrast ? 'high' : undefined,
    'data-motion': p.reduceMotion ? 'reduce' : undefined,
    'data-font': p.readableFont ? 'readable' : undefined,
    'data-links': p.underlineLinks ? 'underline' : undefined,
    'data-thumbs': p.thumbnails === 'medium' ? undefined : p.thumbnails,
    style: p.textSize === 100 ? undefined : `--text-scale: ${p.textSize / 100}`,
  }
}
