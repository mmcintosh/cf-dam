/**
 * Which language a request is in. First match wins, each value checked against the languages we have, so
 * nothing a visitor sends reaches `<html lang>`, a cookie or SQL unchecked. Never throws.
 *
 *   1. the person's own choice (Account → Appearance → Language)
 *   2. the `cfdam_lang` cookie (signed-out pages, and a copy of the choice so the API needn't read it)
 *   3. a client gallery's fixed language, if the photographer set one
 *   4. the browser's Accept-Language
 *   5. the archive's language (chosen at setup)
 *   6. English
 */
import { asLanguage, SOURCE_LANGUAGE, type UiLanguage } from './languages'

export const LANGUAGE_COOKIE = 'cfdam_lang'

export interface LanguageSources {
  preference?: unknown
  cookie?: unknown
  gallery?: unknown
  acceptLanguage?: string | null
  site?: unknown
  /** Allow the pseudo-language (staging and tests). */
  pseudo?: boolean
}

/** Accept-Language as base codes, best first: `fr-CH, fr;q=0.9, en;q=0.8` → fr, en. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return []
  return header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const weight = q ? Number(q.slice(2)) : 1
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, index }
    })
    .filter((x) => x.tag && x.tag !== '*' && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((x) => x.tag)
}

export function resolveLanguage(sources: LanguageSources): UiLanguage {
  try {
    const pseudo = { pseudo: sources.pseudo === true }
    for (const value of [sources.preference, sources.cookie, sources.gallery]) {
      const lang = asLanguage(value, pseudo)
      if (lang) return lang
    }
    for (const tag of parseAcceptLanguage(sources.acceptLanguage)) {
      const lang = asLanguage(tag)
      if (lang) return lang
    }
    return asLanguage(sources.site) ?? SOURCE_LANGUAGE
  } catch {
    return SOURCE_LANGUAGE
  }
}
