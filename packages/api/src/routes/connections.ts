/** Storage connections. Reading the list needs assets:upload (to pick a destination); changes need sources:manage. */
import { Hono, type Context } from 'hono'
import { requirePermission } from '../auth/principal'
import { importPage } from '../catalog/importer'
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
  setDefaultConnection,
} from '../storage/connections'
import { isStorageClass, StorageError, type StorageClass } from '../storage/types'

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

/** Write, read back and delete a probe object: proves credentials, bucket and write access. */
connectionRoutes.post('/:id/test', requirePermission('sources:manage'), async (c) => {
  const connection = await getConnection(c.env.DB, c.req.param('id'))
  if (!connection) return c.json({ error: 'not_found' }, 404)
  try {
    await providerFor(c.env, connection).test()
    return c.json({ ok: true })
  } catch (error) {
    return c.json({ ok: false, message: error instanceof Error ? error.message : 'The test failed.' })
  }
})

/**
 * Catalogue what's already in the bucket, one page (up to 1000 objects) per call. Call again with
 * the returned cursor until it is null. Nothing is copied; previews are made by the sweep.
 */
connectionRoutes.post('/:id/import', requirePermission('sources:manage'), async (c) => {
  const connection = await getConnection(c.env.DB, c.req.param('id'))
  if (!connection) return c.json({ error: 'not_found' }, 404)
  try {
    const body = await readJsonObject(c)
    const result = await importPage(c.env, connection, {
      prefix: optionalString(body, 'prefix', 500),
      cursor: optionalString(body, 'cursor', 2000),
      userId: c.get('principal')!.userId,
    })
    if (result.imported > 0) {
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
  if (!connection) return c.json({ error: 'not_found' }, 404)
  await setDefaultConnection(c.env.DB, connection.id)
  return c.json({ ok: true })
})

connectionRoutes.delete('/:id', requirePermission('sources:manage'), async (c) => {
  const result = await deleteConnection(c.env.DB, c.req.param('id'))
  if (result === 'not-found') return c.json({ error: 'not_found' }, 404)
  if (result === 'built-in') return c.json({ error: 'built_in', message: 'The built-in R2 connection cannot be removed.' }, 409)
  if (result === 'in-use') return c.json({ error: 'in_use', message: 'Originals are stored here. Move them before removing it.' }, 409)
  return c.body(null, 204)
})
