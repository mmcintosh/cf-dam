/**
 * The S3 provider against a real S3-compatible server. Runs when S3_TEST_ENDPOINT is set, e.g.
 *   docker run -d -p 9000:9000 -e RUSTFS_ACCESS_KEY=cfdamtest -e RUSTFS_SECRET_KEY=cfdamtestsecret123 rustfs/rustfs
 *   S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_ACCESS_KEY=cfdamtest S3_TEST_SECRET_KEY=cfdamtestsecret123 npm test
 * These servers check signatures for real, but only know STANDARD: storage classes and restore are
 * covered by the unit tests and by a spike against AWS.
 */
import { AwsClient } from 'aws4fetch'
import { beforeAll, describe, expect, it } from 'vitest'
import { S3Provider } from '../src/storage/s3'

const endpoint = process.env.S3_TEST_ENDPOINT
const credentials = {
  accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? '',
  secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? '',
}
const bucket = `cfdam-test-${Date.now().toString(36)}`

const provider = new S3Provider({
  endpoint: endpoint ?? 'http://unused',
  region: 'us-east-1',
  bucket,
  forcePathStyle: true,
  credentials: async () => credentials,
})

const MiB = 1024 * 1024
const text = (stream: ReadableStream<Uint8Array>) => new Response(stream).text()

describe.skipIf(!endpoint)('S3 provider against a real server', () => {
  beforeAll(async () => {
    const client = new AwsClient({ ...credentials, service: 's3', region: 'us-east-1' })
    const response = await client.fetch(`${endpoint}/${bucket}`, { method: 'PUT' })
    expect(response.ok).toBe(true)
  })

  it('passes the connection test', async () => {
    await expect(provider.test()).resolves.toBeUndefined()
  })

  it('puts, heads, reads a range, lists and deletes, with awkward key names', async () => {
    const key = 'shoots/2024 Ålesund/IMG #1+final.txt'
    await provider.put(key, 'hello archive', { contentType: 'text/plain' })
    expect(await provider.head(key)).toMatchObject({ size: 13, storageClass: 'STANDARD' })
    expect(await text((await provider.get(key, { offset: 6, length: 7 }))!.body)).toBe('archive')
    expect((await provider.list('shoots/')).objects.map((o) => o.key)).toContain(key)
    await provider.delete(key)
    expect(await provider.head(key)).toBeNull()
  })

  it('runs a multipart upload through the Worker path', async () => {
    const key = 'big/proxied.bin'
    const uploadId = await provider.createMultipart(key, { contentType: 'application/octet-stream' })
    const first = new Uint8Array(5 * MiB).fill(1)
    const second = new Uint8Array(1234).fill(2)
    const p1 = await provider.uploadPart(key, uploadId, 1, first.buffer, first.byteLength)
    const p2 = await provider.uploadPart(key, uploadId, 2, second.buffer, second.byteLength)
    await provider.completeMultipart(key, uploadId, [{ partNumber: 2, etag: p2.etag }, { partNumber: 1, etag: p1.etag }])
    expect((await provider.head(key))?.size).toBe(5 * MiB + 1234)
  })

  it('accepts parts uploaded straight to presigned URLs, as a browser would', async () => {
    const key = 'big/direct upload.bin'
    const uploadId = await provider.createMultipart(key)
    const parts = []
    for (const [index, size] of [5 * MiB, 777].entries()) {
      const signed = await provider.presignPart(key, uploadId, index + 1, 600)
      const response = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: new Uint8Array(size).fill(index + 3) })
      expect(response.status).toBe(200)
      parts.push({ partNumber: index + 1, etag: response.headers.get('ETag') ?? '' })
    }
    await provider.completeMultipart(key, uploadId, parts)
    expect((await provider.head(key))?.size).toBe(5 * MiB + 777)
  })

  it('serves a presigned download under the original filename', async () => {
    await provider.put('dl/x.txt', 'download me')
    const signed = await provider.presignGet('dl/x.txt', { expiresSeconds: 60, downloadName: 'Wedding final.txt' })
    const response = await fetch(signed.url)
    expect(await response.text()).toBe('download me')
    expect(response.headers.get('content-disposition')).toContain('Wedding final.txt')
  })

  it('aborts an upload', async () => {
    const uploadId = await provider.createMultipart('big/aborted.bin')
    await provider.abortMultipart('big/aborted.bin', uploadId)
    expect(await provider.head('big/aborted.bin')).toBeNull()
  })

  it('rejects wrong credentials with a readable error', async () => {
    const wrong = new S3Provider({ endpoint: endpoint!, region: 'us-east-1', bucket, forcePathStyle: true, credentials: async () => ({ ...credentials, secretAccessKey: 'nope' }) })
    await expect(wrong.test()).rejects.toThrow(/SignatureDoesNotMatch|AccessDenied/)
  })
})
