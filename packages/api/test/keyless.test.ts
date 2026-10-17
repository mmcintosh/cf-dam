import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoleConnection, providerFor, getConnection } from '../src/storage/connections'
import { activeSigningKey, clearRoleCredentialCache, publishedKeys, signToken, STS_AUDIENCE } from '../src/storage/oidc'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

let h: Harness
let admin: string
beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
  clearRoleCredentialCache()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await h.dispose()
})

const ISSUER = 'https://dam.example.test'
const ROLE = 'arn:aws:iam::123456789012:role/cf-dam-archive'

function decode(part: string): Record<string, unknown> {
  return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
}

describe('signing keys', () => {
  it('creates one key, stores the private half sealed, and publishes only the public half', async () => {
    const first = await activeSigningKey(h.env)
    const again = await activeSigningKey(h.env)
    expect(again.kid).toBe(first.kid)
    const row = await h.env.DB.prepare('SELECT public_jwk, private_sealed FROM signing_keys').first<{ public_jwk: string; private_sealed: string }>()
    expect(row!.private_sealed.startsWith('v1.')).toBe(true)
    expect(JSON.parse(row!.public_jwk)).not.toHaveProperty('d')
    expect((await publishedKeys(h.env.DB)).map((k) => k.kid)).toEqual([first.kid])
  })

  it('signs a short-lived RS256 token that verifies against the published key', async () => {
    const key = await activeSigningKey(h.env)
    const token = await signToken(key, { iss: ISSUER, sub: 'cf-dam:connection:abc', aud: STS_AUDIENCE })
    const [header, payload, signature] = token.split('.') as [string, string, string]
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT', kid: key.kid })
    const claims = decode(payload) as { iss: string; sub: string; aud: string; iat: number; exp: number }
    expect(claims).toMatchObject({ iss: ISSUER, sub: 'cf-dam:connection:abc', aud: 'sts.amazonaws.com' })
    expect(claims.exp - claims.iat).toBe(300)
    const verifier = await crypto.subtle.importKey('jwk', key.publicJwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const sig = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', verifier, sig, new TextEncoder().encode(`${header}.${payload}`))).toBe(true)
  })
})

describe('the issuer endpoints', () => {
  it('serves discovery and the JWKS publicly', async () => {
    const key = await activeSigningKey(h.env)
    const discovery = (await (await h.fetch('/.well-known/openid-configuration')).json()) as Record<string, unknown>
    expect(discovery).toMatchObject({ issuer: 'http://localhost', jwks_uri: 'http://localhost/.well-known/jwks.json' })
    const jwks = (await (await h.fetch('/.well-known/jwks.json')).json()) as { keys: { kid: string; d?: string }[] }
    expect(jwks.keys).toHaveLength(1)
    expect(jwks.keys[0]).toMatchObject({ kid: key.kid, alg: 'RS256' })
    expect(jwks.keys[0]!.d).toBeUndefined()
  })
})

describe('keyless connections', () => {
  it('refuses a malformed role ARN and a non-https issuer', async () => {
    const userId = (await h.env.DB.prepare('SELECT id FROM users').first<{ id: string }>())!.id
    const base = { name: 'x', region: 'us-east-1', bucket: 'b', roleArn: ROLE, issuer: ISSUER }
    await expect(createRoleConnection(h.env, { ...base, roleArn: 'arn:aws:iam::1:user/me' }, userId)).rejects.toThrow(/roleArn/)
    await expect(createRoleConnection(h.env, { ...base, issuer: 'http://localhost' }, userId)).rejects.toThrow(/https/)
  })

  it('explains exactly what to create in AWS', async () => {
    const userId = (await h.env.DB.prepare('SELECT id FROM users').first<{ id: string }>())!.id
    const connection = await createRoleConnection(h.env, { name: 'Archive', region: 'us-east-1', bucket: 'photo-archive', prefix: 'cf-dam', roleArn: ROLE, issuer: ISSUER }, userId)
    expect(connection).toMatchObject({ authMode: 'oidc-role', hasSecret: false, roleArn: ROLE })
    expect(await publishedKeys(h.env.DB)).toHaveLength(1)
    const setup = (await (await h.fetch(`/api/connections/${connection.id}/aws-setup`, { cookie: admin })).json()) as Record<string, unknown>
    expect(setup).toMatchObject({
      identityProvider: { url: ISSUER, audience: 'sts.amazonaws.com', arn: 'arn:aws:iam::123456789012:oidc-provider/dam.example.test' },
      subject: `cf-dam:connection:${connection.id}`,
      trustPolicy: {
        Statement: [
          {
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: { StringEquals: { 'dam.example.test:aud': 'sts.amazonaws.com', 'dam.example.test:sub': `cf-dam:connection:${connection.id}` } },
          },
        ],
      },
      permissionsPolicy: { Statement: [{ Resource: 'arn:aws:s3:::photo-archive/cf-dam/*' }, { Resource: 'arn:aws:s3:::photo-archive' }] },
    })
  })

  it('signs S3 requests with STS credentials, and reuses them until they near expiry', async () => {
    const userId = (await h.env.DB.prepare('SELECT id FROM users').first<{ id: string }>())!.id
    const created = await createRoleConnection(h.env, { name: 'Archive', region: 'us-east-1', bucket: 'photo-archive', roleArn: ROLE, issuer: ISSUER }, userId)
    const seen: { url: string; auth: string | null; token: string | null; body: string }[] = []
    const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      seen.push({ url: request.url, auth: request.headers.get('authorization'), token: request.headers.get('x-amz-security-token'), body: await request.text() })
      if (request.url.startsWith('https://sts.')) {
        const expires = new Date(Date.now() + 3600_000).toISOString()
        return new Response(
          `<AssumeRoleWithWebIdentityResponse><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>ASIATEST</AccessKeyId><SecretAccessKey>temp-secret</SecretAccessKey><SessionToken>session-token</SessionToken><Expiration>${expires}</Expiration></Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`,
        )
      }
      return new Response('', { status: 200, headers: { ETag: '"e"' } })
    }
    const provider = providerFor(h.env, (await getConnection(h.env.DB, created.id))!, fetchStub)
    await provider.put('a.jpg', 'x')
    await provider.put('b.jpg', 'y')

    const sts = seen.filter((s) => s.url.startsWith('https://sts.'))
    expect(sts).toHaveLength(1)
    const form = new URLSearchParams(sts[0]!.body)
    expect(form.get('Action')).toBe('AssumeRoleWithWebIdentity')
    expect(form.get('RoleArn')).toBe(ROLE)
    expect(decode(form.get('WebIdentityToken')!.split('.')[1]!)).toMatchObject({ iss: ISSUER, sub: `cf-dam:connection:${created.id}` })
    const s3 = seen.filter((s) => s.url.includes('photo-archive'))
    expect(s3).toHaveLength(2)
    expect(s3.every((r) => r.auth?.includes('Credential=ASIATEST/') && r.token === 'session-token')).toBe(true)
  })

  it('surfaces AWS’s refusal readably', async () => {
    const userId = (await h.env.DB.prepare('SELECT id FROM users').first<{ id: string }>())!.id
    const created = await createRoleConnection(h.env, { name: 'Archive', region: 'us-east-1', bucket: 'b', roleArn: ROLE, issuer: ISSUER }, userId)
    const denied = async () => new Response('<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized to perform sts:AssumeRoleWithWebIdentity</Message></Error></ErrorResponse>', { status: 403 })
    const provider = providerFor(h.env, (await getConnection(h.env.DB, created.id))!, denied)
    await expect(provider.test()).rejects.toThrow(/AWS refused the role: AccessDenied/)
  })
})

describe('creating a keyless connection over the API', () => {
  it('needs an https origin, so it is refused on plain-http localhost', async () => {
    const res = await h.fetch('/api/connections', { ...json({ authMode: 'oidc-role', name: 'x', region: 'us-east-1', bucket: 'b', roleArn: ROLE }), cookie: admin })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toMatch(/https/)
  })
})
