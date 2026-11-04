#!/usr/bin/env node
/**
 * A client's gallery pages send the browser only some groups of text (GALLERY_TEXT_GROUPS in packages/i18n), not
 * the whole app's. This check, part of `npm run check`, fails if an island on those pages (or anything it imports
 * from this repository) uses a key from another group: in the browser it would show the key instead of the text.
 *
 * It reads each file for strings that are catalogue keys ('gallery.size.small'), and for keys put together in a
 * template (`order.status.${…}`), whose first part is the group.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const ISLANDS = ['src/components/ClientGallery.svelte', 'src/components/LanguageSwitch.svelte', 'src/components/OrderView.svelte']
const PLURAL = /\.(zero|one|two|few|many|other)$/

const groups = (() => {
  const source = readFileSync('packages/i18n/src/index.ts', 'utf8')
  const list = /GALLERY_TEXT_GROUPS = \[([^\]]*)\]/.exec(source)
  if (!list) throw new Error('GALLERY_TEXT_GROUPS not found in packages/i18n/src/index.ts')
  return new Set([...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]))
})()
const keys = new Set(Object.keys(JSON.parse(readFileSync('packages/i18n/src/catalogs/en.json', 'utf8'))).map((k) => k.replace(PLURAL, '')))

const seen = new Set()
const problems = []
function visit(path) {
  if (seen.has(path)) return
  seen.add(path)
  const source = readFileSync(path, 'utf8')
  for (const [, spec] of source.matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
    const target = normalize(join(dirname(path), spec))
    const file = [target, `${target}.ts`, `${target}.svelte`].find((f) => existsSync(f) && !f.endsWith('/'))
    if (file) visit(file)
  }
  for (const [, key] of source.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)['"`]/g)) {
    if (keys.has(key) && !groups.has(key.split('.')[0])) problems.push(`${path}: '${key}'`)
  }
  for (const [, group] of source.matchAll(/\bt\(\s*`([a-zA-Z][a-zA-Z0-9_]*)\./g)) {
    if (!groups.has(group)) problems.push(`${path}: \`${group}.…\``)
  }
}
for (const island of ISLANDS) visit(island)

if (problems.length > 0) {
  console.error(`Gallery pages send only these groups of text to the browser: ${[...groups].join(', ')}.`)
  console.error('These keys are from other groups (add the group to GALLERY_TEXT_GROUPS, or use a key from these):')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`page strings: ${seen.size} files on gallery pages use only ${[...groups].join(', ')}`)
