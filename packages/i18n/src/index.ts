/**
 * The server side of cf-dam's languages: every catalog, `getT(lang)`, the request's language for code
 * that can't be handed it (Svelte's server render), and what a page sends to the browser.
 *
 * Browser code imports `@cf-dam/i18n/client` instead, which carries no catalogs.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import de from './catalogs/de.json'
import en from './catalogs/en.json'
import es from './catalogs/es.json'
import fr from './catalogs/fr.json'
import it from './catalogs/it.json'
import { setServerCurrent, type PageI18n } from './client'
import { createFormat, type Format } from './format'
import { PSEUDO, type Language, type UiLanguage } from './languages'
import { createTranslate, pseudoCatalog, type Catalog, type Translate } from './translate'

export * from './languages'
export * from './resolve'
export { createFormat, type Format } from './format'
export { createTranslate, pseudoize, type Catalog, type Params, type Translate } from './translate'
export type { MessageKey } from './keys'
export { PAGE_DATA_ID, type PageI18n } from './client'

const CATALOGS: Record<Language, Catalog> = { en, es, de, fr, it }
let pseudo: Catalog | null = null

/** A language's own text (partial; English fills the gaps). */
export function catalogFor(lang: UiLanguage): Catalog {
  if (lang === PSEUDO) return (pseudo ??= pseudoCatalog(en))
  return CATALOGS[lang]
}

const translators = new Map<UiLanguage, Translate>()
export function getT(lang: UiLanguage): Translate {
  let t = translators.get(lang)
  if (!t) {
    t = createTranslate(lang, catalogFor(lang), en)
    translators.set(lang, t)
  }
  return t
}

/** What the layout writes into the page (see client.ts). */
export function pageI18n(lang: UiLanguage, timeZone?: string, groups?: readonly string[]): PageI18n {
  const all = lang === 'en' ? en : { ...en, ...catalogFor(lang) }
  // Only these groups of keys (`gallery.…`): a client's gallery page shouldn't carry the whole app's text.
  const catalog = groups ? Object.fromEntries(Object.entries(all).filter(([key]) => groups.includes(key.slice(0, key.indexOf('.'))))) : all
  return { lang, catalog, ...(timeZone ? { timeZone } : {}) }
}

/**
 * The groups of text a client's gallery pages need in the browser (their islands: ClientGallery, SuggestNames,
 * LanguageSwitch, OrderView). scripts/check-page-strings.mjs fails `npm run check` if they use any other.
 */
export const GALLERY_TEXT_GROUPS = ['common', 'gallery', 'language', 'order', 'suggest'] as const

export interface RequestLanguage {
  lang: UiLanguage
  timeZone?: string
}
const store = new AsyncLocalStorage<RequestLanguage>()

/** Run a request's work in its language, so Svelte's server render (via `client.ts`) uses it too. */
export function runInLanguage<T>(language: RequestLanguage, work: () => T): T {
  return store.run({ ...language }, work)
}

/** The current request's language (English outside a request). */
export const currentLanguage = (): UiLanguage => store.getStore()?.lang ?? 'en'
export const currentTimeZone = (): string | undefined => store.getStore()?.timeZone

/**
 * Change the current request's language once more is known (the signed-in person's own choice,
 * read after sign-in). Only inside `runInLanguage`; elsewhere it does nothing.
 */
export function setLanguage(lang: UiLanguage): void {
  const current = store.getStore()
  if (current) current.lang = lang
}

const formats = new Map<string, Format>()
setServerCurrent(() => {
  const { lang, timeZone } = store.getStore() ?? { lang: 'en' as const }
  const id = `${lang}|${timeZone ?? ''}`
  let format = formats.get(id)
  if (!format) {
    format = createFormat(lang, timeZone)
    formats.set(id, format)
  }
  return { lang, t: getT(lang), format }
})
