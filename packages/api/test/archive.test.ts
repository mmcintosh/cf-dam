import { createHash, randomBytes } from 'node:crypto'
import { AwsClient } from 'aws4fetch'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { abandonStaleArchiveUploads } from '../src/catalog/archive'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const s3Endpoint = process.env.S3_TEST_ENDPOINT
const s3Credentials = { accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? '' }
/** S3 takes parts down to 5 MiB; the real size is 64 MiB. */
const PART = 5 * 1024 * 1024

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness({ ARCHIVE_PART_BYTES: String(PART) })
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

const agentFetch = (key: string, path: string, init: RequestInit = {}) =>
  h.fetch(path, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${key}` } })
const call = async <T>(key: string, path: string, body: unknown) => {
  const res = await agentFetch(key, path, json(body))
  return { status: res.status, body: (await res.json()) as T }
}

async function pair(): Promise<{ key: string; sourceId: string; root: string }> {
  const start = (await (await h.fetch('/api/agent/pair/start', json({ name: 'Studio NAS', platform: 'darwin/x64', version: '1.0.0' }))).json()) as { deviceCode: string; userCode: string }
  await h.fetch('/api/sources/pair', { ...json({ code: start.userCode }), cookie: admin })
  const done = (await (await h.fetch('/api/agent/pair/poll', json({ deviceCode: start.deviceCode }))).json()) as { apiKey: string; sourceId: string }
  await agentFetch(done.apiKey, '/api/agent/folders', json({ folders: ['/photos'] }))
  const root = (await (await h.fetch(`/api/sources/${done.sourceId}/roots`, { ...json({ path: '/photos', label: 'Photos' }), cookie: admin })).json()) as { root: { id: string } }
  return { key: done.apiKey, sourceId: done.sourceId, root: root.root.id }
}

const fingerprint = (bytes: Uint8Array) => createHash('sha256').update(bytes.subarray(0, 1024)).digest('hex')

/** Index a file on the agent's NAS, as a scan would. Returns the photo's id. */
async function index(agent: { key: string; root: string }, path: string, bytes: Uint8Array): Promise<string> {
  const { body } = await call<{ results: { assetId: string; result: string }[] }>(agent.key, '/api/agent/assets/batch', {
    items: [{ root: agent.root, path, size: bytes.byteLength, mtime: '2019-06-01T10:00:00Z', quickHash: fingerprint(bytes), metadata: { width: 6000, height: 4000 } }],
  })
  expect(body.results[0]!.result).toBe('created')
  return body.results[0]!.assetId
}

interface Start {
  result: 'archived' | 'verify' | 'upload'
  uploadId?: string
  partCount?: number
  partSize?: number
  sha256?: string
  fromAssetId?: string
}

/** What the agent does for one file: start, send each part with its checksum, complete. */
async function archive(agent: { key: string }, assetId: string, bytes: Uint8Array, options: { corrupt?: number } = {}) {
  const start = await call<Start>(agent.key, '/api/agent/archive/start', { assetId, size: bytes.byteLength, quickHash: fingerprint(bytes) })
  if (start.body.result !== 'upload') return { start: start.body }
  const { uploadId, partCount, partSize } = start.body as Required<Start>
  const parts: { partNumber: number; etag: string; checksum: string }[] = []
  for (let n = 1; n <= partCount; n++) {
    const part = bytes.subarray((n - 1) * partSize, n * partSize)
    const checksum = createHash('sha256').update(part).digest('base64')
    const signed = await call<{ url: string; headers: Record<string, string> }>(agent.key, '/api/agent/archive/part', { uploadId, partNumber: n, checksum })
    expect(signed.status).toBe(200)
    // The bytes as sent: a corrupted part keeps its true checksum, so the bucket can tell.
    const sent = options.corrupt === n ? Uint8Array.from(part, (b, i) => (i === 10 ? b ^ 1 : b)) : part
    const put = await fetch(signed.body.url, { method: 'PUT', headers: signed.body.headers, body: new Uint8Array(sent) })
    if (!put.ok) return { start: start.body, refused: { part: n, status: put.status } }
    parts.push({ partNumber: n, etag: put.headers.get('ETag')!, checksum })
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const done = await call<{ archived?: boolean; key?: string; message?: string }>(agent.key, '/api/agent/archive/complete', { uploadId, parts, sha256 })
  return { start: start.body, done, sha256 }
}

describe('archive settings', () => {
  it('turn archiving on for an agent with an S3 bucket only, and reach the agent', async () => {
    const agent = await pair()
    const patch = (archive: unknown) => h.fetch(`/api/sources/${agent.sourceId}`, { method: 'PATCH', body: JSON.stringify({ archive }), cookie: admin })
    expect((await patch({ connectionId: 'r2' })).status).toBe(400)
    expect((await patch({ connectionId: 'nope' })).status).toBe(400)
    const config = async () => ((await (await agentFetch(agent.key, '/api/agent/config')).json()) as { archive: unknown }).archive
    expect(await config()).toBeNull()
    // Not archiving: starting is refused.
    const id = await index(agent, 'a.NEF', randomBytes(1000))
    expect((await call(agent.key, '/api/agent/archive/start', { assetId: id, size: 1000, quickHash: 'a'.repeat(64) })).status).toBe(409)
  })
})

describe.skipIf(!s3Endpoint)('archiving to a bucket (against a real S3-compatible server)', () => {
  async function bucketConnection(): Promise<string> {
    const bucket = `cfdam-archive-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`
    const client = new AwsClient({ ...s3Credentials, service: 's3', region: 'us-east-1' })
    expect((await client.fetch(`${s3Endpoint}/${bucket}`, { method: 'PUT' })).ok).toBe(true)
    const res = await h.fetch('/api/connections', {
      ...json({ name: 'Glacier', endpoint: s3Endpoint, region: 'us-east-1', bucket, forcePathStyle: true, ...s3Credentials }),
      cookie: admin,
    })
    return ((await res.json()) as { connection: { id: string } }).connection.id
  }

  async function archiving() {
    const agent = await pair()
    const connectionId = await bucketConnection()
    // The test server has no Deep Archive class; on AWS this is DEEP_ARCHIVE.
    const res = await h.fetch(`/api/sources/${agent.sourceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ archive: { connectionId, storageClass: 'STANDARD', fromHour: 22, toHour: 7, maxMbps: 50 } }),
      cookie: admin,
    })
    expect(res.status).toBe(200)
    return { ...agent, connectionId }
  }

  const location = (assetId: string, connectionId: string) =>
    h.env.DB.prepare('SELECT key, storage_class, state, size, etag FROM asset_locations WHERE asset_id = ? AND connection_id = ?').bind(assetId, connectionId).first<Record<string, unknown>>()

  it('sends a file in checksummed parts and records the copy beside the NAS one', async () => {
    const agent = await archiving()
    expect(((await (await agentFetch(agent.key, '/api/agent/config')).json()) as { archive: unknown }).archive).toEqual({ fromHour: 22, toHour: 7, maxMbps: 50 })
    const bytes = randomBytes(2 * PART + 12_345)
    const id = await index(agent, '2019/Bergen/DSC_0001.NEF', bytes)

    const { start, done, sha256 } = await archive(agent, id, bytes)
    expect(start).toMatchObject({ result: 'upload', partCount: 3 })
    expect(done!.body).toMatchObject({ archived: true })
    expect(await location(id, agent.connectionId)).toMatchObject({ state: 'present', size: bytes.byteLength, storage_class: 'STANDARD' })
    expect(await h.env.DB.prepare('SELECT sha256, sha256_verified FROM assets WHERE id = ?').bind(id).first()).toEqual({ sha256, sha256_verified: 1 })
    expect(await h.env.DB.prepare('SELECT COUNT(*) AS n FROM archive_uploads').first('n')).toBe(0)

    // The bucket holds exactly the file.
    const key = (await location(id, agent.connectionId))!.key as string
    const conn = await h.env.DB.prepare('SELECT bucket FROM storage_connections WHERE id = ?').bind(agent.connectionId).first<{ bucket: string }>()
    const client = new AwsClient({ ...s3Credentials, service: 's3', region: 'us-east-1' })
    const back = new Uint8Array(await (await client.fetch(`${s3Endpoint}/${conn!.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`)).arrayBuffer())
    expect(createHash('sha256').update(back).digest('hex')).toBe(sha256)

    // Asked again, nothing to do.
    expect((await archive(agent, id, bytes)).start).toEqual({ result: 'archived' })
  })

  it('has a corrupted part refused by the bucket', async () => {
    const agent = await archiving()
    const bytes = randomBytes(PART + 100)
    const id = await index(agent, 'DSC_0002.NEF', bytes)
    const result = await archive(agent, id, bytes, { corrupt: 2 })
    expect(result.refused).toMatchObject({ part: 2 })
    expect(result.refused!.status).toBeGreaterThanOrEqual(400)
    expect(await location(id, agent.connectionId)).toBeNull()
  })

  it("doesn't upload a duplicate: the agent proves it with the SHA-256, and it shares the copy", async () => {
    const agent = await archiving()
    const bytes = randomBytes(300_000)
    const first = await index(agent, 'a/DSC_0003.NEF', bytes)
    const second = await index(agent, 'b/DSC_0003 copy.NEF', bytes)
    await archive(agent, first, bytes)

    const { start } = await archive(agent, second, bytes)
    expect(start).toMatchObject({ result: 'verify', fromAssetId: first, sha256: createHash('sha256').update(bytes).digest('hex') })
    const wrong = await call(agent.key, '/api/agent/archive/link', { assetId: second, fromAssetId: first, sha256: '0'.repeat(64) })
    expect(wrong.status).toBe(409)
    const linked = await call(agent.key, '/api/agent/archive/link', { assetId: second, fromAssetId: first, sha256: start.sha256 })
    expect(linked.body).toEqual({ archived: true, linked: true })
    expect((await location(second, agent.connectionId))!.key).toBe((await location(first, agent.connectionId))!.key)
  })

  it('refuses a file changed since it was indexed, and anything for a paused agent', async () => {
    const agent = await archiving()
    const bytes = randomBytes(1000)
    const id = await index(agent, 'DSC_0004.NEF', bytes)
    expect((await call(agent.key, '/api/agent/archive/start', { assetId: id, size: 1001, quickHash: fingerprint(bytes) })).status).toBe(409)
    await h.fetch(`/api/sources/${agent.sourceId}`, { method: 'PATCH', body: JSON.stringify({ paused: true }), cookie: admin })
    expect((await call(agent.key, '/api/agent/archive/start', { assetId: id, size: 1000, quickHash: fingerprint(bytes) })).status).toBe(409)
  })

  it('gives up uploads that are aborted or left for a week', async () => {
    const agent = await archiving()
    const bytes = randomBytes(1000)
    const id = await index(agent, 'DSC_0005.NEF', bytes)
    const start = await call<Start>(agent.key, '/api/agent/archive/start', { assetId: id, size: 1000, quickHash: fingerprint(bytes) })
    expect((await call(agent.key, '/api/agent/archive/abort', { uploadId: start.body.uploadId })).body).toEqual({ aborted: true })
    expect((await call(agent.key, '/api/agent/archive/part', { uploadId: start.body.uploadId, partNumber: 1, checksum: 'A'.repeat(43) + '=' })).status).toBe(404)

    await call<Start>(agent.key, '/api/agent/archive/start', { assetId: id, size: 1000, quickHash: fingerprint(bytes) })
    await h.env.DB.prepare("UPDATE archive_uploads SET created_at = '2020-01-01T00:00:00Z'").run()
    expect(await abandonStaleArchiveUploads(h.env)).toBe(1)
    expect(await h.env.DB.prepare('SELECT COUNT(*) AS n FROM archive_uploads').first('n')).toBe(0)
  })
})
