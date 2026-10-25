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
 *
 *   Email (plans/PLAN-E-v2.md): the `MAIL` send_email binding, only when the sending address's domain is set up in
 *   Email Sending (`wrangler email sending list`). The address is this install's own, so it isn't in wrangler.jsonc:
 *   it comes from .env.deploy beside the code (git-ignored) or the environment:
 *     MAIL_FROM=cf-dam@dam.example.com            production
 *     STAGING_MAIL_FROM=cf-dam@stage.example.com  staging
 *     STAGING_MAIL_ALLOW_TO=me@example.com,@example.com   staging may email only these (required with a sender)
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
// Email.
const deployVars = (() => {
  const vars = {}
  try {
    for (const line of readFileSync('.env.deploy', 'utf8').split('\n')) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  } catch {
    // No file: nothing set.
  }
  return { ...vars, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /MAIL_/.test(k))) }
})()
const mailFrom = (staging ? deployVars.STAGING_MAIL_FROM : deployVars.MAIL_FROM) ?? ''
const allowTo = staging ? (deployVars.STAGING_MAIL_ALLOW_TO ?? '') : ''
config.send_email = (config.send_email ?? []).filter((b) => b.name !== 'MAIL')
const vars = { ...(config.vars ?? {}) }
delete vars.MAIL_FROM
delete vars.MAIL_ALLOW_TO
if (!mailFrom) {
  console.log('optional bindings: no sending address (MAIL_FROM), so email stays off')
} else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailFrom)) {
  console.error(`optional bindings: ${mailFrom} isn't an email address`)
  process.exit(1)
} else if (staging && !allowTo) {
  console.error('optional bindings: staging can send only with STAGING_MAIL_ALLOW_TO (it may hold copies of real clients)')
  process.exit(1)
} else {
  const domain = mailFrom.split('@')[1].toLowerCase()
  let enabled
  try {
    const out = execFileSync('npx', ['wrangler', 'email', 'sending', 'list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    // A table: │ zone │ name │ enabled │ tag │
    enabled = out
      .split('\n')
      .map((line) => line.split('│').map((cell) => cell.trim()))
      .some((cells) => cells[2]?.toLowerCase() === domain && cells[3] === 'yes')
  } catch (error) {
    enabled = `${error.stderr ?? error}`.split('\n').find((line) => /ERROR/.test(line)) ?? String(error)
  }
  if (enabled === true) {
    config.send_email.push({ name: 'MAIL', allowed_sender_addresses: [mailFrom] })
    vars.MAIL_FROM = mailFrom
    if (allowTo) vars.MAIL_ALLOW_TO = allowTo
    console.log(`optional bindings: MAIL -> ${mailFrom}${allowTo ? ` (only to ${allowTo})` : ''}`)
  } else {
    const why = typeof enabled === 'string' ? `couldn't check Email Sending: ${enabled}` : `${domain} isn't set up in Email Sending`
    if (staging) {
      console.error(`optional bindings: ${why}`)
      process.exit(1)
    }
    console.warn(`optional bindings: ${why}, so email stays off for this deploy`)
  }
}
if (config.send_email.length === 0) delete config.send_email
config.vars = vars
writeFileSync(CONFIG, JSON.stringify(config))
