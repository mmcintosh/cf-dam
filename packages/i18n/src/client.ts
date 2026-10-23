/**
 * `t` and `format` for code that runs in the browser and is also rendered on the server: Svelte islands.
 * No catalogs are bundled here. In the browser it reads the page's own language and text, which the
 * layout writes once as `<script type="application/json" id="cfdam-i18n">`. On the server the server
 * entry (index.ts) registers how to find the current request's language.
 */
import { createFormat, type Format } from './format'
import type { MessageKey } from './keys'
import { asLanguage, SOURCE_LANGUAGE, type UiLanguage } from './languages'
import { createTranslate, type Catalog, type Params, type Translate } from './translate'

export const PAGE_DATA_ID = 'cfdam-i18n'

/** What the layout writes into the page for the browser. */
export interface PageI18n {
  lang: UiLanguage
  /** English with this language's text over it, so the browser needs no second catalog. */
  catalog: Catalog
  timeZone?: string
}

interface Current {
  lang: UiLanguage
  t: Translate
  format: Format
}

let server: (() => Current) | null = null
let browser: Current | null = null

/** For the server entry only. */
export function setServerCurrent(current: () => Current): void {
  server = current
}

function fromPage(): Current {
  if (browser) return browser
  let data: Partial<PageI18n> = {}
  try {
    data = JSON.parse(document.getElementById(PAGE_DATA_ID)?.textContent ?? '{}') as Partial<PageI18n>
  } catch {}
  const lang = asLanguage(data.lang, { pseudo: true }) ?? SOURCE_LANGUAGE
  const catalog = data.catalog ?? {}
  browser = { lang, t: createTranslate(lang, catalog, catalog), format: createFormat(lang, data.timeZone) }
  return browser
}

const english: Current = { lang: SOURCE_LANGUAGE, t: createTranslate(SOURCE_LANGUAGE, {}, {}), format: createFormat(SOURCE_LANGUAGE) }

function current(): Current {
  if (typeof document !== 'undefined') return fromPage()
  return server?.() ?? english
}

export const t = (key: MessageKey, params?: Params): string => current().t(key, params)
export const format = (): Format => current().format
export const lang = (): UiLanguage => current().lang
