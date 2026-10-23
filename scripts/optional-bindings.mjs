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
 *   On staging (`npm run deploy:staging`): the same with cf-dam-staging-meaning. There it's required: a
 *   missing index, or a lookup that fails, stops the deploy rather than quietly turning the feature off.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const CONFIG = 'dist/server/wrangler.json'
const config = JSON.parse(readFileSync(CONFIG, 'utf8'))
// Set by the build when it was made for an environment (CLOUDFLARE_ENV=staging).
const staging = config.targetEnvironment === 'staging'
const OPTIONAL = [{ field: 'vectorize', binding: 'VECTORS', index: staging ? 'cf-dam-staging-meaning' : 'cf-dam-meaning', what: 'search by meaning', required: staging }]

/** True or false when Wrangler answers; the reason when it couldn't tell (no permission, no network). */
function indexExists(name) {
  try {
    const out = execFileSync('npx', ['wrangler', 'vectorize', 'get', name, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return JSON.parse(out).name === name
  } catch (error) {
    const said = `${error.stdout ?? ''}${error.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '')
    if (/not.?found|does not exist|\b404\b/i.test(said)) return false
    return said.split('\n').filter((line) => /ERROR|code:/.test(line)).map((line) => line.trim()).join(' ') || String(error)
  }
}

for (const { field, binding, index, what, required } of OPTIONAL) {
  const list = (config[field] ?? []).filter((b) => b.binding !== binding)
  const found = indexExists(index)
  if (typeof found === 'string' || (required && !found)) {
    const why = typeof found === 'string' ? `couldn't check ${index}: ${found}` : `no ${index} index`
    if (required) {
      console.error(`optional bindings: ${why}. Staging needs it: npx wrangler vectorize create ${index} --dimensions=1024 --metric=cosine`)
      process.exit(1)
    }
    console.warn(`optional bindings: ${why}, so ${what} stays off for this deploy`)
    config[field] = list
  } else if (found) {
    config[field] = [...list, { binding, index_name: index }]
    console.log(`optional bindings: ${binding} -> ${index} (${what} on)`)
  } else {
    config[field] = list
    console.log(`optional bindings: no ${index} index, so ${what} stays off`)
  }
}
writeFileSync(CONFIG, JSON.stringify(config))
