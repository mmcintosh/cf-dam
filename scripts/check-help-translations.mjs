#!/usr/bin/env node
/**
 * Help translations (src/content/help/<lang>/<slug>.md) against their English articles:
 *  - a translation must have an English article with the same slug, and `review:` and `source:` in its front matter;
 *  - `source:` is the first 12 hex of the SHA-256 of the English file it was made from; when the English
 *    article changes, the translation is listed as out of date (a warning: update it, then its `source:`).
 * Part of `npm run check`.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'src/content/help'
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12)
const field = (text, name) => text.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim()

const problems = []
const stale = []
let count = 0
for (const lang of readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory())) {
  for (const file of readdirSync(join(ROOT, lang)).filter((f) => f.endsWith('.md'))) {
    count += 1
    const english = join(ROOT, file)
    const text = readFileSync(join(ROOT, lang, file), 'utf8')
    if (!existsSync(english)) problems.push(`${lang}/${file}: no English article ${file}`)
    if (!field(text, 'review')) problems.push(`${lang}/${file}: no review: in front matter`)
    const source = field(text, 'source')
    if (!source) problems.push(`${lang}/${file}: no source: in front matter`)
    else if (existsSync(english) && source !== hash(english)) stale.push(`${lang}/${file} (English is now ${hash(english)})`)
  }
}
if (stale.length) console.warn(`help: out of date with English, update them:\n  ${stale.join('\n  ')}`)
if (problems.length) {
  console.error(`help translations:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`help: ${count} translations checked`)
