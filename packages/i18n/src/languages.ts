/** The languages cf-dam speaks. English is the source; the others may be partial and fall back to it, key by key. */
export const LANGUAGES = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
  { code: 'de', name: 'Deutsch', dir: 'ltr' },
  { code: 'fr', name: 'Français', dir: 'ltr' },
  { code: 'it', name: 'Italiano', dir: 'ltr' },
] as const

export type Language = (typeof LANGUAGES)[number]['code']
export const SOURCE_LANGUAGE: Language = 'en'

/**
 * The pseudo-language, for testing: English made accented and a third longer, so text that isn't
 * translatable yet stands out as plain English and layouts show where longer languages won't fit.
 * Offered only where `pseudo` is allowed (staging), never to real people by default.
 */
export const PSEUDO = 'en-XA'
export type UiLanguage = Language | typeof PSEUDO

const CODES = new Set<string>(LANGUAGES.map((l) => l.code))

/** Narrow anything (a cookie, a header, a stored value) to a language we have, or null. */
export function asLanguage(value: unknown, options: { pseudo?: boolean } = {}): UiLanguage | null {
  if (typeof value !== 'string') return null
  if (options.pseudo && value === PSEUDO) return PSEUDO
  const base = value.trim().toLowerCase().split(/[-_]/)[0] ?? ''
  return CODES.has(base) ? (base as Language) : null
}

export const direction = (lang: UiLanguage): 'ltr' | 'rtl' => LANGUAGES.find((l) => l.code === lang)?.dir ?? 'ltr'

/** The BCP 47 tag Intl and `<html lang>` should use: the pseudo-language formats as English. */
export const intlTag = (lang: UiLanguage): string => (lang === PSEUDO ? 'en' : lang)
