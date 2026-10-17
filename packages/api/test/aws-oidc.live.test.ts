/**
 * Keyless AWS, end to end against real AWS: a cf-dam-signed token, swapped at STS for temporary
 * credentials, used on S3. Needs an issuer AWS can reach, so it runs in two steps:
 *
 *   1. OIDC_KEYGEN_OUT=/path/key.json npx vitest run test/aws-oidc.live.test.ts
 *      → writes a key pair (made by cf-dam's own code) and prints nothing secret
 *   2. publish discovery + JWKS for that key at an https issuer, create the IAM OIDC provider and role,
 *      then: OIDC_KEY_FILE=/path/key.json OIDC_ISSUER=https://… OIDC_ROLE_ARN=arn:… AWS_LIVE_BUCKET=… npx vitest run test/aws-oidc.live.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { S3Provider } from '../src/storage/s3'
import { assumeRoleWithWebIdentity, connectionSubject, discoveryDocument, generateSigningKey, importSigningKey, signToken, STS_AUDIENCE, type PublishedJwk } from '../src/storage/oidc'

const keygenOut = process.env.OIDC_KEYGEN_OUT
const keyFile = process.env.OIDC_KEY_FILE
const issuer = process.env.OIDC_ISSUER
const roleArn = process.env.OIDC_ROLE_ARN
const bucket = process.env.AWS_LIVE_BUCKET
const connectionId = process.env.OIDC_CONNECTION_ID ?? 'spike'

describe.skipIf(!keygenOut)('keygen for the keyless spike', () => {
  it('writes a signing key pair and the documents to publish', async () => {
    const key = await generateSigningKey()
    writeFileSync(keygenOut!, JSON.stringify(key), { mode: 0o600 })
    writeFileSync(`${keygenOut}.jwks.json`, JSON.stringify({ keys: [key.publicJwk] }))
    expect(key.publicJwk).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig', kid: key.kid })
  })
})

describe.skipIf(!keyFile || !issuer || !roleArn || !bucket)('keyless AWS against real STS and S3', () => {
  it('serves a discovery document AWS can use', () => {
    expect(discoveryDocument(issuer!)).toMatchObject({ issuer, jwks_uri: `${issuer}/.well-known/jwks.json`, id_token_signing_alg_values_supported: ['RS256'] })
  })

  it('swaps a cf-dam token for temporary credentials and uses them on S3', async () => {
    const stored = JSON.parse(new TextDecoder().decode(readFileSync(keyFile!))) as { kid: string; publicJwk: PublishedJwk; privateJwk: JsonWebKey }
    const key = await importSigningKey(stored.kid, stored.publicJwk, stored.privateJwk)
    const token = await signToken(key, { iss: issuer!, sub: connectionSubject(connectionId), aud: STS_AUDIENCE })
    const credentials = await assumeRoleWithWebIdentity({ roleArn: roleArn!, token, sessionName: `cf-dam-${connectionId}`, region: 'us-east-1' })
    expect(credentials.accessKeyId).toMatch(/^ASIA/)
    expect(Date.parse(credentials.expiration)).toBeGreaterThan(Date.now())

    const provider = new S3Provider({
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      region: 'us-east-1',
      bucket: bucket!,
      credentials: async () => credentials,
    })
    await provider.test()
  })

  it('is refused for a token naming another connection', async () => {
    const stored = JSON.parse(new TextDecoder().decode(readFileSync(keyFile!))) as { kid: string; publicJwk: PublishedJwk; privateJwk: JsonWebKey }
    const key = await importSigningKey(stored.kid, stored.publicJwk, stored.privateJwk)
    const token = await signToken(key, { iss: issuer!, sub: connectionSubject('someone-else'), aud: STS_AUDIENCE })
    await expect(assumeRoleWithWebIdentity({ roleArn: roleArn!, token, sessionName: 'cf-dam-other', region: 'us-east-1' })).rejects.toThrow(/AccessDenied/)
  })
})
