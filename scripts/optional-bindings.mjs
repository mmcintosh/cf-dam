#!/usr/bin/env node
/**
 * Bindings for resources a person makes by hand, added at deploy time only when they exist.
 *
 * Wrangler makes D1, R2 and KV on a first deploy (that's what keeps the Deploy button one-click), but
 * not a Vectorize index. A binding to an index that isn't there fails the deploy, so it can't sit in
 * wrangler.jsonc. This adds it to the built config (dist/server/wrangler.json, what `wrangler deploy`
 * uses after `astro build`) when the account has the index, and leaves it out otherwise.
 *
 *   Search by meaning: npx wrangler vectorize create cf-dam-meaning --dimensions=1024 --metric=cosine
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const CONFIG = 'dist/server/wrangler.json'
const OPTIONAL = [{ field: 'vectorize', binding: 'VECTORS', index: 'cf-dam-meaning', what: 'search by meaning' }]

function indexExists(name) {
  try {
    const out = execFileSync('npx', ['wrangler', 'vectorize', 'get', name, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return JSON.parse(out).name === name
  } catch {
    return false
  }
}

const config = JSON.parse(readFileSync(CONFIG, 'utf8'))
for (const { field, binding, index, what } of OPTIONAL) {
  const list = (config[field] ?? []).filter((b) => b.binding !== binding)
  if (indexExists(index)) {
    config[field] = [...list, { binding, index_name: index }]
    console.log(`optional bindings: ${binding} -> ${index} (${what} on)`)
  } else {
    config[field] = list
    console.log(`optional bindings: no ${index} index, so ${what} stays off`)
  }
}
writeFileSync(CONFIG, JSON.stringify(config))
