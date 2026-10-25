#!/usr/bin/env node
/**
 * The last check before `wrangler deploy`: the build in dist/ is for the place we mean to deploy.
 *
 *   node scripts/deploy-target.mjs production   a production build (no environment)
 *   node scripts/deploy-target.mjs staging      a staging build, every resource a staging one
 *
 * Staging lives in the same Cloudflare account as the real archive, so a staging deploy that somehow
 * carried production's names would write over the live site or touch real photos. This stops it.
 */
import { readFileSync } from 'node:fs'

const want = process.argv[2]
if (want !== 'production' && want !== 'staging') {
  console.error('deploy-target: say production or staging')
  process.exit(2)
}
const config = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'))
const built = config.targetEnvironment ?? 'production'
const names = [
  ['Worker', config.name],
  ...(config.d1_databases ?? []).map((d) => ['D1', d.database_name]),
  ...(config.r2_buckets ?? []).map((b) => ['R2', b.bucket_name]),
  ...(config.queues?.producers ?? []).map((q) => ['queue', q.queue]),
  ...(config.queues?.consumers ?? []).map((q) => ['queue', q.queue]),
  ...(config.vectorize ?? []).map((v) => ['Vectorize', v.index_name]),
]
const problems = []
// Email: staging only ever to its allow list; production never with one (it would quietly email nobody).
const mail = (config.send_email ?? []).find((b) => b.name === 'MAIL')
if (mail && want === 'staging' && !config.vars?.MAIL_ALLOW_TO) problems.push('staging email has no allow list (STAGING_MAIL_ALLOW_TO)')
if (mail && want === 'production' && config.vars?.MAIL_ALLOW_TO) problems.push('production email has an allow list: that is for staging')
if (built !== want) problems.push(`the build in dist/ is for ${built}, not ${want}`)
for (const [kind, name] of names) {
  const isStaging = typeof name === 'string' && name.includes('staging')
  if (want === 'staging' && !isStaging) problems.push(`${kind} "${name}" isn't a staging resource`)
  if (want === 'production' && isStaging) problems.push(`${kind} "${name}" is a staging resource`)
}
if (problems.length) {
  console.error(`deploy-target: not deploying.\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`deploy-target: ${want} build, ${names.map(([, n]) => n).join(', ')}`)
