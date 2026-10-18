/**
 * Storage connections: the configured places originals can live, and the providers that reach them.
 */
import type { DamBindings } from '../env'
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { R2Provider } from './r2'
import { bucketOrigin, S3Provider } from './s3'
import { activeSigningKey, roleCredentials } from './oidc'
import { deriveKey, open, seal, storageSecret } from './secret-box'
import { isStorageClass, S3_STORAGE_CLASSES, StorageError, type StorageClass, type StorageProvider } from './types'

export const BUILT_IN_CONNECTION = 'r2'

export type AuthMode = 'binding' | 'access-key' | 'oidc-role' | 'agent'

export interface Connection {
  id: string
  name: string
  /** 'nas': files a paired agent indexed in place. The Worker can never read them. */
  provider: 'r2-binding' | 's3' | 'nas'
  endpoint: string | null
  region: string | null
  bucket: string | null
  prefix: string
  forcePathStyle: boolean
  authMode: AuthMode
  roleArn: string | null
  accessKeyId: string | null
  hasSecret: boolean
  storageClasses: StorageClass[]
  defaultClass: StorageClass
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

interface ConnectionRow {
  id: string
  name: string
  provider: string
  endpoint: string | null
  region: string | null
  bucket: string | null
  prefix: string
  force_path_style: number
  auth_mode: string
  role_arn: string | null
  access_key_id: string | null
  secret_sealed: string | null
  storage_classes: string
  default_class: string
  is_default: number
  created_at: string
  updated_at: string
}

function parseClasses(raw: string): StorageClass[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter(isStorageClass) : ['STANDARD']
  } catch {
    return ['STANDARD']
  }
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider === 's3' || row.provider === 'nas' ? row.provider : 'r2-binding',
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    prefix: row.prefix,
    forcePathStyle: row.force_path_style === 1,
    authMode: row.auth_mode as AuthMode,
    roleArn: row.role_arn,
    accessKeyId: row.access_key_id,
    hasSecret: row.secret_sealed !== null,
    storageClasses: parseClasses(row.storage_classes),
    defaultClass: isStorageClass(row.default_class) ? row.default_class : 'STANDARD',
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function getRow(db: D1Database, id: string): Promise<ConnectionRow | null> {
  return db.prepare('SELECT * FROM storage_connections WHERE id = ?').bind(id).first<ConnectionRow>()
}

/** Storage people can upload to and manage: R2 and S3. NAS agents' connections are listed with their agents. */
export async function listConnections(db: D1Database): Promise<Connection[]> {
  const { results } = await db
    .prepare("SELECT * FROM storage_connections WHERE provider != 'nas' ORDER BY is_default DESC, created_at")
    .all<ConnectionRow>()
  return results.map(toConnection)
}

/**
 * Where browsers reach buckets directly (presigned upload parts, video playback), for the pages'
 * CSP. Path style as providerFor uses it: keyless (role) connections are always virtual-hosted.
 */
export async function browserOrigins(db: D1Database): Promise<string[]> {
  const buckets = (await listConnections(db)).filter((c) => c.provider === 's3' && c.endpoint && c.bucket)
  return [...new Set(buckets.map((c) => bucketOrigin({ endpoint: c.endpoint!, bucket: c.bucket!, forcePathStyle: c.authMode === 'access-key' && c.forcePathStyle })))]
}

export async function getConnection(db: D1Database, id: string): Promise<Connection | null> {
  const row = await getRow(db, id)
  return row ? toConnection(row) : null
}

export async function defaultConnection(db: D1Database): Promise<Connection> {
  const row =
    (await db.prepare('SELECT * FROM storage_connections WHERE is_default = 1 LIMIT 1').first<ConnectionRow>()) ??
    (await getRow(db, BUILT_IN_CONNECTION))
  if (!row) throw new StorageError('No storage connection is configured.', 'NoConnection')
  return toConnection(row)
}

/** AWS endpoints get every storage class by default; other S3 services only STANDARD. */
export function isAwsEndpoint(endpoint: string): boolean {
  return /(^|\.)amazonaws\.com(\.cn)?$/i.test(new URL(endpoint).hostname)
}

export interface S3ConnectionInput {
  name: string
  endpoint: string
  region: string
  bucket: string
  prefix?: string
  forcePathStyle?: boolean
  accessKeyId: string
  secretAccessKey: string
  storageClasses?: StorageClass[]
  defaultClass?: StorageClass
}

export function validateEndpoint(endpoint: string): string {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new StorageError('The endpoint is not a URL.', 'InvalidEndpoint')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new StorageError('The endpoint must use https (http is allowed only for localhost).', 'InvalidEndpoint')
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`
}

export async function createS3Connection(env: DamBindings, input: S3ConnectionInput, userId: string): Promise<Connection> {
  const endpoint = validateEndpoint(input.endpoint)
  const classes = input.storageClasses?.length
    ? input.storageClasses
    : isAwsEndpoint(endpoint)
      ? [...S3_STORAGE_CLASSES]
      : (['STANDARD'] as StorageClass[])
  const defaultClass = input.defaultClass ?? 'STANDARD'
  if (!classes.includes(defaultClass)) throw new StorageError('The default class must be one the connection offers.', 'InvalidStorageClass')

  const key = await deriveKey(storageSecret(env))
  const id = randomId()
  const now = nowIso()
  await env.DB.prepare(
    `INSERT INTO storage_connections
       (id, name, provider, endpoint, region, bucket, prefix, force_path_style, auth_mode, access_key_id,
        secret_sealed, storage_classes, default_class, is_default, created_by, created_at, updated_at)
     VALUES (?, ?, 's3', ?, ?, ?, ?, ?, 'access-key', ?, ?, ?, ?, 0, ?, ?, ?)`,
  )
    .bind(
      id,
      input.name,
      endpoint,
      input.region,
      input.bucket,
      (input.prefix ?? '').replace(/^\/+/, ''),
      input.forcePathStyle ? 1 : 0,
      input.accessKeyId,
      await seal(key, input.secretAccessKey),
      JSON.stringify(classes),
      defaultClass,
      userId,
      now,
      now,
    )
    .run()
  return (await getConnection(env.DB, id))!
}

export interface RoleConnectionInput {
  name: string
  region: string
  bucket: string
  prefix?: string
  roleArn: string
  /** The public origin AWS trusts as the token issuer, e.g. https://dam.example.com. */
  issuer: string
  storageClasses?: StorageClass[]
  defaultClass?: StorageClass
}

const ROLE_ARN = /^arn:aws(-[a-z]+)*:iam::(\d{12}):role\/[\w+=,.@\/-]{1,512}$/

/** A keyless AWS connection: no stored secret, temporary credentials from STS per use. */
export async function createRoleConnection(env: DamBindings, input: RoleConnectionInput, userId: string): Promise<Connection> {
  const match = ROLE_ARN.exec(input.roleArn)
  if (!match) throw new StorageError('roleArn must look like arn:aws:iam::123456789012:role/name.', 'InvalidRoleArn')
  const issuer = new URL(input.issuer)
  if (issuer.protocol !== 'https:') throw new StorageError('AWS only trusts https issuers. Use the deployment’s public https address.', 'InvalidIssuer')
  const classes = input.storageClasses?.length ? input.storageClasses : [...S3_STORAGE_CLASSES]
  const defaultClass = input.defaultClass ?? 'STANDARD'
  if (!classes.includes(defaultClass)) throw new StorageError('The default class must be one the connection offers.', 'InvalidStorageClass')

  const id = randomId()
  const now = nowIso()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO storage_connections
         (id, name, provider, endpoint, region, bucket, prefix, force_path_style, auth_mode, role_arn,
          storage_classes, default_class, is_default, created_by, created_at, updated_at)
       VALUES (?, ?, 's3', ?, ?, ?, ?, 0, 'oidc-role', ?, ?, ?, 0, ?, ?, ?)`,
    ).bind(
      id, input.name, `https://s3.${input.region}.amazonaws.com`, input.region, input.bucket,
      (input.prefix ?? '').replace(/^\/+/, ''), input.roleArn, JSON.stringify(classes), defaultClass, userId, now, now,
    ),
    env.DB.prepare('INSERT INTO connection_oidc (connection_id, issuer, account_id) VALUES (?, ?, ?)').bind(id, issuer.origin, match[2]),
  ])
  // Publish the signing key now, so the JWKS already holds it while the AWS side is being set up.
  await activeSigningKey(env)
  return (await getConnection(env.DB, id))!
}

export async function connectionIssuer(db: D1Database, id: string): Promise<{ issuer: string; accountId: string } | null> {
  const row = await db.prepare('SELECT issuer, account_id FROM connection_oidc WHERE connection_id = ?').bind(id).first<{ issuer: string; account_id: string }>()
  return row ? { issuer: row.issuer, accountId: row.account_id } : null
}

export async function setDefaultConnection(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('UPDATE storage_connections SET is_default = 0 WHERE is_default = 1'),
    db.prepare('UPDATE storage_connections SET is_default = 1, updated_at = ? WHERE id = ?').bind(nowIso(), id),
  ])
}

/** Delete a connection that holds no originals. The built-in R2 connection can't be deleted. */
export async function deleteConnection(db: D1Database, id: string): Promise<'deleted' | 'in-use' | 'built-in' | 'not-found'> {
  if (id === BUILT_IN_CONNECTION) return 'built-in'
  const row = await getRow(db, id)
  // An agent's connection goes with the agent (sources), not from the storage page.
  if (!row || row.provider === 'nas') return 'not-found'
  const used = await db.prepare('SELECT 1 AS used FROM asset_locations WHERE connection_id = ? LIMIT 1').bind(id).first()
  if (used) return 'in-use'
  if (row.is_default === 1) await setDefaultConnection(db, BUILT_IN_CONNECTION)
  await db.prepare('DELETE FROM storage_connections WHERE id = ?').bind(id).run()
  return 'deleted'
}

/** Prefix a key with the connection's prefix. */
export function connectionKey(connection: Connection, key: string): string {
  return connection.prefix ? `${connection.prefix.replace(/\/+$/, '')}/${key}` : key
}

/** A provider for a connection. Credentials are unsealed lazily, on the first request that needs them. */
export function providerFor(env: DamBindings, connection: Connection, fetchImpl?: typeof fetch): StorageProvider {
  if (connection.provider === 'nas') {
    throw new StorageError(`The original is on ${connection.name}; only its agent can read it.`, 'OnNas', 409)
  }
  if (connection.provider === 'r2-binding') {
    if (!env.MEDIA_BUCKET) throw new StorageError('The MEDIA_BUCKET binding is missing.', 'NoBinding')
    return new R2Provider(env.MEDIA_BUCKET)
  }
  if (connection.authMode === 'oidc-role') {
    return new S3Provider({
      endpoint: connection.endpoint!,
      region: connection.region ?? 'us-east-1',
      bucket: connection.bucket!,
      storageClasses: connection.storageClasses,
      fetch: fetchImpl,
      credentials: async () => {
        const oidc = await connectionIssuer(env.DB, connection.id)
        if (!oidc || !connection.roleArn) throw new StorageError('This keyless connection is missing its role or issuer.', 'NoCredentials')
        return roleCredentials({
          env,
          connectionId: connection.id,
          issuer: oidc.issuer,
          roleArn: connection.roleArn,
          region: connection.region ?? undefined,
          fetch: fetchImpl,
        })
      },
    })
  }
  if (connection.authMode !== 'access-key') {
    throw new StorageError(`Connections using ${connection.authMode} are not supported yet.`, 'UnsupportedAuth')
  }
  let cached: Promise<{ accessKeyId: string; secretAccessKey: string }> | null = null
  return new S3Provider({
    endpoint: connection.endpoint!,
    region: connection.region ?? 'us-east-1',
    bucket: connection.bucket!,
    forcePathStyle: connection.forcePathStyle,
    storageClasses: connection.storageClasses,
    fetch: fetchImpl,
    credentials: () => {
      cached ??= (async () => {
        const row = await getRow(env.DB, connection.id)
        if (!row?.secret_sealed || !row.access_key_id) throw new StorageError('This connection has no credentials.', 'NoCredentials')
        const secretAccessKey = await open(await deriveKey(storageSecret(env)), row.secret_sealed)
        return { accessKeyId: row.access_key_id, secretAccessKey }
      })()
      return cached
    },
  })
}

/** The built-in R2 provider, where renditions are kept. */
export function renditionStore(env: DamBindings): StorageProvider {
  if (!env.MEDIA_BUCKET) throw new StorageError('The MEDIA_BUCKET binding is missing.', 'NoBinding')
  return new R2Provider(env.MEDIA_BUCKET)
}
