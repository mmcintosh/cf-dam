/**
 * `t(key, params)`: the text for a key in one language, falling back to English key by key.
 *
 * It returns plain text. Astro and Svelte escape it when they render it, so values in `{placeholders}`
 * (names, file names) are safe as long as the result is never passed to `set:html` or `{@html}`.
 * Numbers in placeholders are formatted for the language. Plural keys take `{ count }` and pick the
 * language's form with Intl.PluralRules ("one", "other", and "many" in Spanish, French and Italian).
 *
 * Never call it at module level: a label table built once would stay in the first request's language.
 * Keep keys in such tables and translate where they're shown.
 */
import { intlTag, PSEUDO, type UiLanguage } from './languages'
import type { MessageKey } from './keys'
import { PLURAL_KEYS } from './keys'

export type Catalog = Readonly<Record<string, string>>
export type Params = Readonly<Record<string, string | number>>
export type Translate = (key: MessageKey, params?: Params) => string

const warned = new Set<string>()

/** `catalog` is the language's own text; `english` the fallback (the same object for English). */
export function createTranslate(lang: UiLanguage, catalog: Catalog, english: Catalog): Translate {
  const tag = intlTag(lang)
  const plurals = new Intl.PluralRules(tag)
  const numbers = new Intl.NumberFormat(tag)

  const lookup = (key: string): string | undefined => catalog[key] ?? english[key]

  return (key, params) => {
    let text: string | undefined
    if (PLURAL_KEYS.has(key)) {
      const count = Number(params?.count ?? 0)
      const form = plurals.select(count)
      // The language's own form, then its "other", then English's.
      text = catalog[`${key}.${form}`] ?? catalog[`${key}.other`] ?? english[`${key}.${new Intl.PluralRules('en').select(count)}`] ?? english[`${key}.other`]
    } else {
      text = lookup(key)
    }
    if (text === undefined) {
      if (!warned.has(key)) {
        warned.add(key)
        console.warn(`[i18n] no text for "${key}"`)
      }
      return key
    }
    if (!params) return text
    return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
      const value = params[name]
      if (value === undefined) return match
      return typeof value === 'number' ? numbers.format(value) : value
    })
  }
}

const ACCENTED: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ü', c: 'ç', n: 'ñ', A: 'Å', E: 'É', I: 'Î', O: 'Ø', U: 'Ü', C: 'Ç', N: 'Ñ', y: 'ý', s: 'š' }

/** English made recognisably foreign and ~35% longer; `{placeholders}` and `<tags>` left intact. */
export function pseudoize(text: string): string {
  const parts = text.split(/(\{[a-zA-Z0-9_]+\}|<[^>]+>)/)
  const body = parts.map((part, i) => (i % 2 === 1 ? part : part.replace(/[a-zA-Z]/g, (ch) => ACCENTED[ch] ?? ch))).join('')
  const visible = text.replace(/\{[^}]+\}|<[^>]+>/g, '').length
  return `⟦${body}${visible > 3 ? ` ${'·'.repeat(Math.ceil(visible * 0.4))}` : ''}⟧`
}

/** The pseudo-language's catalog, made from English. */
export function pseudoCatalog(english: Catalog): Catalog {
  return Object.fromEntries(Object.entries(english).map(([key, value]) => [key, pseudoize(value)]))
}

export { PSEUDO }
