/** Storage connections. Reading the list needs assets:upload (to pick a destination); changes need sources:manage. */
import { Hono, type Context } from 'hono'
import { requirePermission } from '../auth/principal'
import { importPage } from '../catalog/importer'
import { nudge } from '../catalog/work'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, optionalString, readJsonObject, requiredString, stringArray } from '../lib/http'
import { connectionSubject, STS_AUDIENCE, trustPolicy } from '../storage/oidc'
import {
  connectionIssuer,
  createRoleConnection,
  createS3Connection,
  deleteConnection,
  getConnection,
  listConnections,
  providerFor,
  ConnectionInUse,
  connectionKey,
  recordTest,
  setDefaultConnection,
  underPrefix,
  updateConnection,
  type ConnectionPatch,
} from '../storage/connections'
import { connectionUsage, connectionUses, inUse } from '../storage/usage'
import { getArchiveJobSettings } from '../catalog/archive-jobs'
import { getBackupConfig } from '../catalog/backups'
import { randomId } from '../lib/crypto'
import { isStorageClass, StorageError, type StorageClass } from '../storage/types'
import { say } from '../lib/language'

export const connectionRoutes = new Hono<DamEnv>()

function failure(c: Context<DamEnv>, error: unknown) {
  if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
  if (error instanceof StorageError) return c.json({ error: 'storage_error', code: error.code, message: error.message }, 400)
  throw error
}

connectionRoutes.get('/', requirePermission('assets:upload'), async (c) => {
  return c.json({ connections: await listConnections(c.env.DB) })
})

connectionRoutes.post('/', requirePermission('sources:manage'), async (c) => {
  try {
    const body = await readJsonObject(c)
    if (body.authMode === 'oidc-role') {
      const classes = stringArray(body, 'storageClasses')
      if (classes && !classes.every(isStorageClass)) throw new BadRequest('storageClasses contains an unknown class.')
      const connection = await createRoleConnection(
        c.env,
        {
          name: requiredString(body, 'name', 100),
          region: requiredString(body, 'region', 50),
          bucket: requiredString(body, 'bucket', 63),
          prefix: optionalString(body, 'prefix', 200),
          roleArn: requiredString(body, 'roleArn', 600),
          issuer: c.env.BETTER_AUTH_URL ?? new URL(c.req.url).origin,
          storageClasses: classes as StorageClass[] | undefined,
          defaultClass: isStorageClass(body.defaultClass) ? body.defaultClass : undefined,
        },
        c.get('principal')!.userId,
      )
      await logActivity(c.env.DB, {
        userId: c.get('principal')!.userId,
        action: 'storage.connection_created',
        targetType: 'storage_connection',
        targetId: connection.id,
        details: { name: connection.name, bucket: connection.bucket, authMode: 'oidc-role', roleArn: connection.roleArn },
      })
      return c.json({ connection, setup: await awsSetup(c.env.DB, connection.id) }, 201)
    }
    const classes = stringArray(body, 'storageClasses')
    if (classes && !classes.every(isStorageClass)) throw new BadRequest('storageClasses contains an unknown class.')
    const defaultClass = optionalString(body, 'defaultClass', 32)
    if (defaultClass !== undefined && !isStorageClass(defaultClass)) throw new BadRequest('defaultClass is not a storage class.')
    const connection = await createS3Connection(
      c.env,
      {
        name: requiredString(body, 'name', 100),
        endpoint: requiredString(body, 'endpoint', 300),
        region: requiredString(body, 'region', 50),
        bucket: requiredString(body, 'bucket', 63),
        prefix: optionalString(body, 'prefix', 200),
        forcePathStyle: body.forcePathStyle === true,
        accessKeyId: requiredString(body, 'accessKeyId', 128),
        secretAccessKey: requiredString(body, 'secretAccessKey', 256),
        storageClasses: classes as StorageClass[] | undefined,
        defaultClass: defaultClass as StorageClass | undefined,
      },
      c.get('principal')!.userId,
    )
    await logActivity(c.env.DB, {
      userId: c.get('principal')!.userId,
      action: 'storage.connection_created',
      targetType: 'storage_connection',
      targetId: connection.id,
      details: { name: connection.name, endpoint: connection.endpoint, bucket: connection.bucket },
    })
    return c.json({ connection }, 201)
  } catch (error) {
    return failure(c, error)
  }
})

/** What to create in the AWS account for a keyless connection. */
async function awsSetup(db: D1Database, id: string) {
  const connection = await getConnection(db, id)
  const oidc = await connectionIssuer(db, id)
  if (!connection || !oidc) return null
  const host = new URL(oidc.issuer).host
  const prefix = connection.prefix ? `${connection.prefix.replace(/\/+$/, '')}/` : ''
  return {
    identityProvider: { url: oidc.issuer, audience: STS_AUDIENCE, arn: `arn:aws:iam::${oidc.accountId}:oidc-provider/${host}` },
    subject: connectionSubject(id),
    roleArn: connection.roleArn,
    trustPolicy: trustPolicy({ accountId: oidc.accountId, issuer: oidc.issuer, connectionId: id }),
    permissionsPolicy: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject', 's3:RestoreObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'],
          Resource: `arn:aws:s3:::${connection.bucket}/${prefix}*`,
        },
        { Effect: 'Allow', Action: ['s3:ListBucket'], Resource: `arn:aws:s3:::${connection.bucket}` },
      ],
    },
  }
}

connectionRoutes.get('/:id/aws-setup', requirePermission('sources:manage'), async (c) => {
  const setup = await awsSetup(c.env.DB, c.req.param('id'))
  return setup ? c.json(setup) : c.json({ error: 'not_found' }, 404)
})

/** Write, read back and delete a probe object: proves credentials, bucket and write access. The result is kept. */
connectionRoutes.post('/:id/test', requirePermission('sources:manage'), async (c) => {
  const connection = await getConnection(c.env.DB, c.req.param('id'))
  if (!connection || connection.provider === 'nas') return c.json({ error: 'not_found' }, 404)
  try {
    // cf-dam's own probe goes under the prefix, where a keyless role may write.
    await underPrefix(providerFor(c.env, connection), connection.prefix).test()
    await recordTest(c.env.DB, connection.id, true, null)
    return c.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The test failed.'
    await recordTest(c.env.DB, connection.id, false, message)
    return c.json({ ok: false, message })
  }
})

/**
 * The Storage page's rows (plans/PLAN-ST-v2.md): each connection with what it keeps and what uses it. Apart from the
 * plain list above, which the uploader and every page's CSP read.
 */
connectionRoutes.get('/overview', requirePermission('sources:manage'), async (c) => {
  const connections = await listConnections(c.env.DB)
  const [usage, uses] = await Promise.all([
    connectionUsage(c.env.DB, connections.map((x) => x.id)),
    Promise.all(connections.map((x) => connectionUses(c.env.DB, x.id))),
  ])
  return c.json({ connections: connections.map((x, i) => ({ ...x, usage: usage.get(x.id), uses: uses[i] })) })
})

/** One connection's page: the connection, what it keeps, what uses it, and what that use is set to. */
connectionRoutes.get('/:id/details', requirePermission('sources:manage'), async (c) => {
  const connection = await getConnection(c.env.DB, c.req.param('id'))
  if (!connection || connection.provider === 'nas') return c.json({ error: 'not_found' }, 404)
  const [usage, uses, newest, jobs, backup] = await Promise.all([
    connectionUsage(c.env.DB, [connection.id]),
    connectionUses(c.env.DB, connection.id),
    c.env.DB.prepare("SELECT MAX(started_at) AS at FROM backups WHERE connection_id = ? AND status = 'done'").bind(connection.id).first<{ at: string | null }>(),
    getArchiveJobSettings(c.env.DB),
    getBackupConfig(c.env.DB),
  ])
  return c.json({
    connection,
    usage: usage.get(connection.id),
    uses,
    locked: inUse(uses),
    newestBackup: newest?.at ?? null,
    jobArchive: uses.jobArchive ? { storageClass: jobs.storageClass, afterDays: jobs.afterDays } : null,
    backupHour: uses.backupDestination ? backup.hour : null,
  })
})

/** Change a connection: name, classes, role or keys; where the bucket is only while nothing uses it. */
connectionRoutes.patch('/:id', requirePermission('sources:manage'), async (c) => {
  const id = c.req.param('id')
  try {
    const body = await readJsonObject(c)
    const patch: ConnectionPatch = {}
    const text = (key: 'name' | 'roleArn' | 'accessKeyId' | 'secretAccessKey' | 'bucket' | 'region' | 'endpoint' | 'prefix', max: number) => {
      const value = optionalString(body, key, max)
      if (value !== undefined) patch[key] = value
    }
    text('name', 100)
    text('roleArn', 600)
    text('accessKeyId', 128)
    text('secretAccessKey', 256)
    text('bucket', 63)
    text('region', 50)
    text('endpoint', 300)
    if (body.prefix !== undefined) patch.prefix = typeof body.prefix === 'string' ? body.prefix.trim().slice(0, 200) : ''
    if (patch.name !== undefined && !patch.name) throw new BadRequest('name is required.')
    if (body.forcePathStyle !== undefined) patch.forcePathStyle = body.forcePathStyle === true
    const classes = stringArray(body, 'storageClasses')
    if (classes) {
      if (!classes.every(isStorageClass)) throw new BadRequest('storageClasses contains an unknown class.')
      patch.storageClasses = classes as StorageClass[]
    }
    if (body.defaultClass !== undefined) {
      if (!isStorageClass(body.defaultClass)) throw new BadRequest('defaultClass is not a storage class.')
      patch.defaultClass = body.defaultClass
    }
    const connection = await updateConnection(c.env, id, patch, { classUse: (cls) => classInUse(c.env.DB, id, cls), lockedMessage: say('err.connectionInUseFields') })
    // What changed, never the secret.
    const { secretAccessKey, ...shown } = patch
    await logActivity(c.env.DB, {
      userId: c.get('principal')!.userId,
      action: 'storage.connection_changed',
      targetType: 'storage_connection',
      targetId: id,
      details: { name: connection.name, ...shown, ...(secretAccessKey ? { secretAccessKey: 'replaced' } : {}) },
    })
    return c.json({ connection })
  } catch (error) {
    if (error instanceof ConnectionInUse) return c.json({ error: 'in_use', message: error.message }, 409)
    if (error instanceof StorageError && error.status === 404) return c.json({ error: 'not_found' }, 404)
    return failure(c, error)
  }
})

/** What needs a storage class of this connection, in words, or null: the job archive, a helper's archive. */
async function classInUse(db: D1Database, id: string, storageClass: StorageClass): Promise<string | null> {
  const jobs = await getArchiveJobSettings(db)
  if (jobs.connectionId === id && jobs.storageClass === storageClass) return say('err.classInUse', { class: storageClass, what: say('storagePage.chipJobArchive') })
  const agent = await db
    .prepare("SELECT name FROM sources WHERE json_extract(archive, '$.connectionId') = ? AND json_extract(archive, '$.storageClass') = ? LIMIT 1")
    .bind(id, storageClass)
    .first<{ name: string }>()
  return agent ? say('err.classInUse', { class: storageClass, what: agent.name }) : null
}

/** cf-dam's folder for the browser upload test's probe (the importer skips it). */
const BROWSER_PROBE = '.cf-dam-browser-test'

/**
 * Uploading from the browser, tested the way the uploader does it: a multipart upload begun here, one part the
 * browser PUTs straight to the bucket (which needs the bucket's CORS rule), then given up. Nothing is left behind.
 */
connectionRoutes.post('/:id/browser-test', requirePermission('sources:manage'), async (c) => {
  const connection = await getConnection(c.env.DB, c.req.param('id'))
  if (!connection || connection.provider !== 's3') return c.json({ error: 'not_found' }, 404)
  try {
    const provider = providerFor(c.env, connection)
    if (!provider.presignPart) return c.json({ error: 'no_presign', message: 'This connection uploads through cf-dam, not straight from the browser.' }, 409)
    const token = randomId()
    const key = connectionKey(connection, `${BROWSER_PROBE}/${token}`)
    const uploadId = await provider.createMultipart(key, { contentType: 'application/octet-stream' })
    const part = await provider.presignPart(key, uploadId, 1, 300)
    return c.json({ url: part.url, headers: part.headers, token, uploadId })
  } catch (error) {
    return failure(c, error)
  }
})

/** The browser test is over: give up its upload. Only cf-dam's own probe key, from the token it handed out. */
connectionRoutes.post('/:id/browser-test/done', requirePermission('sources:manage'), async (c) => {
  const connection = await getConnection(c.env.DB, c.req.param('id'))
  if (!connection || connection.provider !== 's3') return c.json({ error: 'not_found' }, 404)
  try {
    const body = await readJsonObject(c)
    const token = requiredString(body, 'token', 64)
    const uploadId = requiredString(body, 'uploadId', 1024)
    if (!/^[0-9a-f]{32}$/.test(token)) throw new BadRequest('token is the one the test handed out.')
    await providerFor(c.env, connection).abortMultipart(connectionKey(connection, `${BROWSER_PROBE}/${token}`), uploadId).catch(() => {})
    return c.json({ ok: true })
  } catch (error) {
    return failure(c, error)
  }
})

/**
 * Catalogue what's already in the bucket, one page (up to 1000 objects) per call. Call again with
 * the returned cursor until it is null. Nothing is copied; previews are made by the sweep.
 */
connectionRoutes.post('/:id/import', requirePermission('sources:manage'), async (c) => {
  const connection = await getConnection(c.env.DB, c.req.param('id'))
  if (!connection || connection.provider === 'nas') return c.json({ error: 'not_found' }, 404)
  try {
    const body = await readJsonObject(c)
    const result = await importPage(c.env, connection, {
      prefix: optionalString(body, 'prefix', 500),
      cursor: optionalString(body, 'cursor', 2000),
      userId: c.get('principal')!.userId,
    })
    if (result.imported > 0) {
      await nudge(c.env, 'process', result.imported)
      await logActivity(c.env.DB, {
        userId: c.get('principal')!.userId,
        action: 'storage.imported',
        targetType: 'storage_connection',
        targetId: connection.id,
        details: { imported: result.imported },
      })
    }
    return c.json(result)
  } catch (error) {
    return failure(c, error)
  }
})

connectionRoutes.post('/:id/default', requirePermission('sources:manage'), async (c) => {
  const connection = await getConnection(c.env.DB, c.req.param('id'))
  if (!connection || connection.provider === 'nas') return c.json({ error: 'not_found' }, 404)
  await setDefaultConnection(c.env.DB, connection.id)
  return c.json({ ok: true })
})

connectionRoutes.delete('/:id', requirePermission('sources:manage'), async (c) => {
  const result = await deleteConnection(c.env.DB, c.req.param('id'))
  if (result === 'not-found') return c.json({ error: 'not_found' }, 404)
  if (result === 'built-in') return c.json({ error: 'built_in', message: say('err.builtInConnection') }, 409)
  if (result === 'in-use') return c.json({ error: 'in_use', message: say('err.connectionInUse'), uses: await connectionUses(c.env.DB, c.req.param('id')) }, 409)
  return c.body(null, 204)
})
