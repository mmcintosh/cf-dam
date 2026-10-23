#!/usr/bin/env node
/**
 * Two checks for the languages work (packages/i18n), part of `npm run check`:
 *
 * 1. A ratchet on hard-coded English in pages and components. Each file's count of English text nodes and
 *    translatable attributes (placeholder, title, aria-label, alt) may only go down: a change that adds one
 *    fails. Translate it with t(); or, for words that aren't language (a brand, a code), end the line with
 *    `<!-- i18n-ok -->` or `// i18n-ok`. After translating, `node scripts/check-i18n-literals.mjs --update`
 *    lowers the recorded counts (scripts/i18n-literals.json).
 *
 * 2. No t() or say() at module level in TypeScript: a label table built when the file loads would stay in the
 *    first request's language. Keep keys in such tables and translate where they're shown.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASELINE = 'scripts/i18n-literals.json'
const ROOTS = ['src/components', 'src/pages', 'src/layouts']
const TEXT = />[ \t]*[A-Z][a-z][^<>{}]{2,}</g
const ATTR = /\b(?:placeholder|title|aria-label|alt)="[A-Z][a-z][^"]*"/g

function* walk(dir, test) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path, test)
    else if (test(name)) yield path
  }
}

function count(path) {
  const lines = readFileSync(path, 'utf8').replace(/<style[\s\S]*?<\/style>/g, '').split('\n')
  let n = 0
  for (const line of lines) {
    if (/i18n-ok/.test(line)) continue
    n += (line.match(TEXT)?.length ?? 0) + (line.match(ATTR)?.length ?? 0)
  }
  return n
}

const counts = {}
for (const root of ROOTS) for (const path of walk(root, (n) => /\.(svelte|astro)$/.test(n))) counts[path] = count(path)
const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
const total = Object.values(sorted).reduce((a, b) => a + b, 0)

if (process.argv.includes('--update')) {
  const before = JSON.parse(readFileSync(BASELINE, 'utf8'))
  // Only ever lower a count (or drop a file): raising one is what the check is for.
  const next = Object.fromEntries(Object.entries(sorted).map(([path, n]) => [path, Math.min(n, before[path] ?? n)]))
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`i18n literals: baseline updated, ${total} left`)
  process.exit(0)
}

const problems = []
let baseline = {}
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
} catch {
  writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`)
  console.log(`i18n literals: baseline written, ${total} to translate`)
  baseline = sorted
}
for (const [path, n] of Object.entries(sorted)) {
  const allowed = baseline[path] ?? 0
  if (n > allowed) problems.push(`${path}: ${n} hard-coded English (was ${allowed}). Use t(), or mark a line i18n-ok.`)
}

// 2. Module-level t()/say() in TypeScript.
for (const root of ['src/lib', 'packages/api/src']) {
  for (const path of walk(root, (n) => n.endsWith('.ts'))) {
    readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
      if (/^(?:export\s+)?(?:const|let|var)\s+[^=]+=\s*(?![^=]*=>)[^\n]*\b(?:t|say|getT\([^)]*\))\(/.test(line)) problems.push(`${path}:${i + 1}: t()/say() at module level`)
    })
  }
}

if (problems.length) {
  console.error(`i18n literals:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`i18n literals: ${total} hard-coded English left to translate, none added`)
