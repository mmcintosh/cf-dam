#!/usr/bin/env node
/**
 * Stops a build whose Worker would fail as soon as it loads on Cloudflare.
 *
 * `createRequire(import.meta.url)` works in Node and in `astro dev`, but in a deployed Worker
 * `import.meta.url` is undefined, so the module throws on import and every page that uses it is a 500.
 * It sneaks in when a page imports something that drags build-time code along (as the help pages did
 * by importing from content.config.ts, which brought Astro's file loader with it).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'dist/server'
const BAD = /createRequire\(\s*import\.meta\.url\s*\)/

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (/\.(m?js)$/.test(entry.name)) yield path
  }
}

const found = [...files(ROOT)].filter((path) => BAD.test(readFileSync(path, 'utf8')))
if (found.length) {
  console.error(`check-bundle: these would fail to load on Cloudflare (createRequire(import.meta.url)):\n  ${found.join('\n  ')}`)
  console.error('Look for a page or component importing build-time code, such as src/content.config.ts.')
  process.exit(1)
}
console.log('check-bundle: Worker bundle OK')
