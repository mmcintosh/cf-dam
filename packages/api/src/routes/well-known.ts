/**
 * cf-dam's OpenID Connect issuer metadata, served at the site root (not under /api) because AWS
 * fetches `<issuer>/.well-known/openid-configuration`. Public by design: it holds only public keys.
 */
import { Hono } from 'hono'
import type { DamEnv } from '../env'
import { discoveryDocument, publishedKeys } from '../storage/oidc'

export const wellKnownRoutes = new Hono<DamEnv>()

const issuerFor = (env: DamEnv['Bindings'], request: Request) => env.BETTER_AUTH_URL ?? new URL(request.url).origin

wellKnownRoutes.get('/openid-configuration', (c) =>
  c.json(discoveryDocument(issuerFor(c.env, c.req.raw)), 200, { 'Cache-Control': 'public, max-age=300' }),
)

wellKnownRoutes.get('/jwks.json', async (c) =>
  c.json({ keys: await publishedKeys(c.env.DB) }, 200, { 'Cache-Control': 'public, max-age=300' }),
)
