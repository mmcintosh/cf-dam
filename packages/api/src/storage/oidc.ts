/**
 * Keyless AWS access: cf-dam is its own OpenID Connect issuer.
 *
 * It publishes a discovery document and a JWKS at its public origin. The AWS account trusts that
 * origin as an IAM OIDC identity provider, with a role that only cf-dam's tokens for one connection
 * can assume. To reach S3, the Worker signs a five-minute token and swaps it at STS
 * (AssumeRoleWithWebIdentity, which needs no AWS credentials) for temporary keys. No long-lived AWS
 * secret is stored anywhere. GitHub Actions reaches AWS the same way.
 */
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { deriveKey, open, seal, storageSecret } from './secret-box'
import { StorageError } from './types'
import { xmlValue } from './xml'
import type { AwsCredentials } from './s3'

export const STS_AUDIENCE = 'sts.amazonaws.com'
const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const
const TOKEN_TTL_SECONDS = 300

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  let binary = ''
  for (const b of bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const base64UrlJson = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)))

/** A public key as published in the JWKS: a JWK plus the fields JWKS consumers look for. */
export type PublishedJwk = JsonWebKey & { kid: string; use: 'sig'; alg: 'RS256' }

export interface SigningKey {
  kid: string
  publicJwk: PublishedJwk
  privateKey: CryptoKey
}

/** RFC 7638 thumbprint, used as the key id. */
async function thumbprint(jwk: JsonWebKey): Promise<string> {
  const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))
}

export async function generateSigningKey(): Promise<{ kid: string; publicJwk: PublishedJwk; privateJwk: JsonWebKey }> {
  const pair = (await crypto.subtle.generateKey(
    { ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const exported = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  const kid = await thumbprint(exported)
  return { kid, publicJwk: { kty: 'RSA', n: exported.n, e: exported.e, alg: 'RS256', use: 'sig', kid }, privateJwk }
}

export async function importSigningKey(kid: string, publicJwk: PublishedJwk, privateJwk: JsonWebKey): Promise<SigningKey> {
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, ALG, false, ['sign'])
  return { kid, publicJwk, privateKey }
}

/** The active signing key, created (and stored sealed) on first use. */
export async function activeSigningKey(env: { DB: D1Database; STORAGE_ENCRYPTION_KEY?: string; BETTER_AUTH_SECRET?: string }): Promise<SigningKey> {
  const sealKey = await deriveKey(storageSecret(env))
  const row = await env.DB.prepare('SELECT kid, public_jwk, private_sealed FROM signing_keys WHERE retired_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .first<{ kid: string; public_jwk: string; private_sealed: string }>()
  if (row) {
    return importSigningKey(row.kid, JSON.parse(row.public_jwk) as PublishedJwk, JSON.parse(await open(sealKey, row.private_sealed)) as JsonWebKey)
  }
  const fresh = await generateSigningKey()
  await env.DB.prepare('INSERT OR IGNORE INTO signing_keys (kid, alg, public_jwk, private_sealed, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(fresh.kid, 'RS256', JSON.stringify(fresh.publicJwk), await seal(sealKey, JSON.stringify(fresh.privateJwk)), nowIso())
    .run()
  // Another isolate may have raced us; whichever row is newest wins, and both stay published.
  return activeSigningKey(env)
}

/** Every unretired public key, for the JWKS. */
export async function publishedKeys(db: D1Database): Promise<PublishedJwk[]> {
  const { results } = await db.prepare('SELECT public_jwk FROM signing_keys WHERE retired_at IS NULL ORDER BY created_at DESC').all<{ public_jwk: string }>()
  return results.map((r) => JSON.parse(r.public_jwk) as PublishedJwk)
}

export function discoveryDocument(issuer: string) {
  return {
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ['id_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    claims_supported: ['sub', 'aud', 'iss', 'iat', 'exp'],
  }
}

export async function signToken(key: SigningKey, claims: { iss: string; sub: string; aud: string }, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000)
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT', kid: key.kid })
  const payload = base64UrlJson({ ...claims, iat, nbf: iat - 30, exp: iat + TOKEN_TTL_SECONDS, jti: randomId() })
  const signature = await crypto.subtle.sign(ALG, key.privateKey, new TextEncoder().encode(`${header}.${payload}`))
  return `${header}.${payload}.${base64Url(signature)}`
}

/** The `sub` a connection's tokens carry; the role's trust policy pins it. */
export const connectionSubject = (connectionId: string) => `cf-dam:connection:${connectionId}`

export interface TemporaryCredentials extends AwsCredentials {
  sessionToken: string
  expiration: string
}

/** STS AssumeRoleWithWebIdentity. The call itself is unsigned: the token is the credential. */
export async function assumeRoleWithWebIdentity(options: {
  roleArn: string
  token: string
  sessionName: string
  region?: string
  durationSeconds?: number
  fetch?: typeof fetch
}): Promise<TemporaryCredentials> {
  const endpoint = options.region ? `https://sts.${options.region}.amazonaws.com/` : 'https://sts.amazonaws.com/'
  const body = new URLSearchParams({
    Action: 'AssumeRoleWithWebIdentity',
    Version: '2011-06-15',
    RoleArn: options.roleArn,
    RoleSessionName: options.sessionName.replace(/[^\w+=,.@-]/g, '-').slice(0, 64),
    WebIdentityToken: options.token,
    DurationSeconds: String(options.durationSeconds ?? 3600),
  })
  const response = await (options.fetch ?? fetch)(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const xml = await response.text()
  if (!response.ok) {
    const code = xmlValue(xml, 'Code') ?? `HTTP${response.status}`
    throw new StorageError(`AWS refused the role: ${code}${xmlValue(xml, 'Message') ? ` (${xmlValue(xml, 'Message')})` : ''}`, code, response.status)
  }
  const accessKeyId = xmlValue(xml, 'AccessKeyId')
  const secretAccessKey = xmlValue(xml, 'SecretAccessKey')
  const sessionToken = xmlValue(xml, 'SessionToken')
  const expiration = xmlValue(xml, 'Expiration')
  if (!accessKeyId || !secretAccessKey || !sessionToken || !expiration) {
    throw new StorageError('STS answered without credentials.', 'NoCredentials')
  }
  return { accessKeyId, secretAccessKey, sessionToken, expiration }
}

// Temporary credentials per connection, reused until five minutes before they expire.
const cache = new Map<string, TemporaryCredentials>()

export async function roleCredentials(options: {
  env: { DB: D1Database; STORAGE_ENCRYPTION_KEY?: string; BETTER_AUTH_SECRET?: string }
  connectionId: string
  issuer: string
  roleArn: string
  region?: string
  fetch?: typeof fetch
}): Promise<TemporaryCredentials> {
  const cached = cache.get(options.connectionId)
  if (cached && Date.parse(cached.expiration) - Date.now() > 5 * 60_000) return cached
  const key = await activeSigningKey(options.env)
  const token = await signToken(key, { iss: options.issuer, sub: connectionSubject(options.connectionId), aud: STS_AUDIENCE })
  const credentials = await assumeRoleWithWebIdentity({
    roleArn: options.roleArn,
    token,
    sessionName: `cf-dam-${options.connectionId}`,
    region: options.region,
    fetch: options.fetch,
  })
  cache.set(options.connectionId, credentials)
  return credentials
}

export function clearRoleCredentialCache(): void {
  cache.clear()
}

/** The IAM trust policy a connection's role needs, for the setup screen. */
export function trustPolicy(options: { accountId: string; issuer: string; connectionId: string }) {
  const host = new URL(options.issuer).host + new URL(options.issuer).pathname.replace(/\/$/, '')
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Federated: `arn:aws:iam::${options.accountId}:oidc-provider/${host}` },
        Action: 'sts:AssumeRoleWithWebIdentity',
        Condition: {
          StringEquals: {
            [`${host}:aud`]: STS_AUDIENCE,
            [`${host}:sub`]: connectionSubject(options.connectionId),
          },
        },
      },
    ],
  }
}
