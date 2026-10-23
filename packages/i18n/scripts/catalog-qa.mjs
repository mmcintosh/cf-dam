#!/usr/bin/env node
/**
 * Checks the catalogs (npm run check):
 *  - every key in a language exists in English (no orphans), and no value is empty;
 *  - placeholders match English exactly ({name} in English means {name} in the translation);
 *  - each plural key has every form the language needs (Intl.PluralRules), where it's translated at all;
 *  - every translated key has a review status (machine → ai-reviewed → ai-reviewed-2 → native-confirmed).
 * Untranslated keys are allowed (English shows); the count is reported.
 */
import { readFileSync } from 'node:fs'

const LANGS = ['es', 'de', 'fr', 'it']
const STATUSES = new Set(['machine', 'ai-reviewed', 'ai-reviewed-2', 'native-confirmed'])
const PLURAL = /\.(zero|one|two|few|many|other)$/
const read = (name) => JSON.parse(readFileSync(new URL(`../src/catalogs/${name}.json`, import.meta.url), 'utf8'))
// Markup a catalog text may carry (for tHtml): these tags only, and a translation keeps English's.
const ALLOWED_TAGS = new Set(['strong', 'em', 'code', 'a', 'kbd', 'br'])
const tags = (text) => [...text.matchAll(/<\/?([a-zA-Z]+)[^>]*>/g)].map((m) => m[0].startsWith('</') ? `/${m[1]}` : m[1]).sort().join(',')
const placeholders = (text) => [...new Set([...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]))].sort().join(",")

const en = read('en')
const review = read('review-status')
const problems = []
const pluralBases = new Set(Object.keys(en).filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, '')))

for (const [key, value] of Object.entries(en)) {
  if (!String(value).trim()) problems.push(`en: "${key}" is empty`)
  for (const m of String(value).matchAll(/<\/?([a-zA-Z]+)([^>]*)>/g)) {
    if (!ALLOWED_TAGS.has(m[1])) problems.push(`en: "${key}" uses <${m[1]}>; only ${[...ALLOWED_TAGS].join(', ')} are allowed`)
    if (/\son\w+=|javascript:/i.test(m[2])) problems.push(`en: "${key}" has a script attribute in <${m[1]}>`)
  }
}
for (const base of pluralBases) if (!(`${base}.other` in en)) problems.push(`en: "${base}" has plural forms but no .other`)
// A key ending in a plural form's name reads as a plural: `x.other` must have a sibling `x.one`.
for (const key of Object.keys(en)) if (PLURAL.test(key) && !(`${key.replace(PLURAL, '')}.one` in en)) problems.push(`en: "${key}" ends like a plural form (.${key.split('.').pop()}); rename it`)

for (const lang of LANGS) {
  const catalog = read(lang)
  const needed = new Intl.PluralRules(lang).resolvedOptions().pluralCategories
  for (const [key, value] of Object.entries(catalog)) {
    const base = key.replace(PLURAL, '')
    const inEnglish = key in en || (PLURAL.test(key) && pluralBases.has(base))
    if (!inEnglish) problems.push(`${lang}: "${key}" isn't in English`)
    if (!String(value).trim()) problems.push(`${lang}: "${key}" is empty`)
    const source = en[key] ?? en[`${base}.other`] ?? ''
    if (inEnglish && placeholders(value) !== placeholders(source)) problems.push(`${lang}: "${key}" has {${placeholders(value)}}, English has {${placeholders(source)}}`)
    if (inEnglish && tags(value) !== tags(source)) problems.push(`${lang}: "${key}" markup differs from English`)
    if (!STATUSES.has(review[key]?.[lang])) problems.push(`${lang}: "${key}" has no review status`)
  }
  for (const base of pluralBases) {
    const has = needed.filter((form) => `${base}.${form}` in catalog)
    if (has.length > 0 && has.length < needed.length) problems.push(`${lang}: "${base}" needs forms ${needed.join(', ')}; has ${has.join(', ')}`)
  }
  const done = Object.keys(en).filter((key) => key in catalog).length
  console.log(`i18n: ${lang} ${done}/${Object.keys(en).length} texts translated`)
}

if (problems.length) {
  console.error(`i18n catalog problems:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
