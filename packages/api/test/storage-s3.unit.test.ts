import { describe, expect, it } from 'vitest'
import { encodeKey, parseRestoreHeader, S3Provider, type S3Config } from '../src/storage/s3'
import { attachmentDisposition, S3_STORAGE_CLASSES } from '../src/storage/types'

interface Recorded {
  method: string
  url: URL
  headers: Headers
  body: string
}

/** An S3Provider whose fetch records each request and answers from `respond`. */
function recordingProvider(respond: (req: Recorded) => Response, overrides: Partial<S3Config> = {}) {
  const calls: Recorded[] = []
  const provider = new S3Provider({
    endpoint: 'https://s3.us-east-1.amazonaws.com',
    region: 'us-east-1',
    bucket: 'photo-archive',
    storageClasses: S3_STORAGE_CLASSES,
    credentials: async () => ({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }),
    fetch: async (input, init) => {
      const request = new Request(input, init)
      const call = { method: request.method, url: new URL(request.url), headers: request.headers, body: await request.text() }
      calls.push(call)
      return respond(call)
    },
    ...overrides,
  })
  return { provider, calls }
}

const ok = () => new Response('', { status: 200, headers: { ETag: '"abc"' } })

describe('addressing', () => {
  it('uses virtual-hosted URLs for AWS and path-style when asked', () => {
    const { provider } = recordingProvider(ok)
    expect(provider.url('2024/wedding/a b+c.CR3').toString()).toBe(
      'https://photo-archive.s3.us-east-1.amazonaws.com/2024/wedding/a%20b%2Bc.CR3',
    )
    const path = recordingProvider(ok, { endpoint: 'http://localhost:9000', forcePathStyle: true }).provider
    expect(path.url('x/y.jpg', { uploads: '' }).toString()).toBe('http://localhost:9000/photo-archive/x/y.jpg?uploads=')
  })

  it('encodes each key segment but keeps slashes', () => {
    expect(encodeKey('Ålesund/2019 trip/IMG#1.jpg')).toBe('%C3%85lesund/2019%20trip/IMG%231.jpg')
  })
})

describe('storage classes', () => {
  it('sends x-amz-storage-class for non-STANDARD classes and omits it for STANDARD', async () => {
    const { provider, calls } = recordingProvider(ok)
    await provider.put('a.jpg', 'x', { storageClass: 'DEEP_ARCHIVE', contentType: 'image/jpeg' })
    await provider.put('b.jpg', 'x', { storageClass: 'STANDARD' })
    expect(calls[0]!.headers.get('x-amz-storage-class')).toBe('DEEP_ARCHIVE')
    expect(calls[0]!.headers.get('content-type')).toBe('image/jpeg')
    expect(calls[0]!.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request/)
    expect(calls[1]!.headers.has('x-amz-storage-class')).toBe(false)
  })

  it('refuses a class the connection does not offer', async () => {
    const { provider } = recordingProvider(ok, { storageClasses: ['STANDARD'] })
    await expect(provider.put('a.jpg', 'x', { storageClass: 'GLACIER' })).rejects.toThrow(/does not offer GLACIER/)
  })

  it('changes class with an in-place copy', async () => {
    const { provider, calls } = recordingProvider((req) =>
      req.method === 'HEAD'
        ? new Response(null, { status: 200, headers: { 'Content-Length': '10', ETag: '"e"' } })
        : new Response('<CopyObjectResult><ETag>"e"</ETag></CopyObjectResult>', { status: 200 }),
    )
    await provider.setStorageClass('2024/a b.jpg', 'GLACIER_IR')
    const copy = calls[1]!
    expect(copy.method).toBe('PUT')
    expect(copy.headers.get('x-amz-copy-source')).toBe('/photo-archive/2024/a%20b.jpg')
    expect(copy.headers.get('x-amz-metadata-directive')).toBe('COPY')
    expect(copy.headers.get('x-amz-storage-class')).toBe('GLACIER_IR')
  })

  it('won’t change the class of an archived object that is not restored', async () => {
    const { provider } = recordingProvider(() =>
      new Response(null, { status: 200, headers: { 'Content-Length': '10', 'x-amz-storage-class': 'DEEP_ARCHIVE' } }),
    )
    await expect(provider.setStorageClass('a.jpg', 'STANDARD')).rejects.toThrow(/Restore it/)
  })

  it('treats a copy that answers 200 with an <Error> body as a failure', async () => {
    const { provider } = recordingProvider((req) =>
      req.method === 'HEAD'
        ? new Response(null, { status: 200, headers: { 'Content-Length': '10' } })
        : new Response('<Error><Code>InternalError</Code></Error>', { status: 200 }),
    )
    await expect(provider.setStorageClass('a.jpg', 'STANDARD_IA')).rejects.toThrow(/InternalError/)
  })
})

describe('restore', () => {
  it('posts a RestoreRequest with days and tier', async () => {
    const { provider, calls } = recordingProvider(() => new Response('', { status: 202 }))
    expect(await provider.restore('a.jpg', { days: 7, tier: 'Bulk' })).toBe('started')
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url.searchParams.has('restore')).toBe(true)
    expect(calls[0]!.body).toContain('<Days>7</Days>')
    expect(calls[0]!.body).toContain('<Tier>Bulk</Tier>')
  })

  it('maps 200 and RestoreAlreadyInProgress', async () => {
    expect(await recordingProvider(() => new Response('', { status: 200 })).provider.restore('a', { days: 1, tier: 'Standard' })).toBe(
      'already-restored',
    )
    const conflict = () => new Response('<Error><Code>RestoreAlreadyInProgress</Code></Error>', { status: 409 })
    expect(await recordingProvider(conflict).provider.restore('a', { days: 1, tier: 'Standard' })).toBe('in-progress')
  })

  it('reads restore state from HEAD', async () => {
    const { provider } = recordingProvider(() =>
      new Response(null, {
        status: 200,
        headers: {
          'Content-Length': '42',
          'x-amz-storage-class': 'DEEP_ARCHIVE',
          'x-amz-restore': 'ongoing-request="false", expiry-date="Fri, 21 Dec 2012 00:00:00 GMT"',
        },
      }),
    )
    expect(await provider.head('a')).toMatchObject({
      size: 42,
      storageClass: 'DEEP_ARCHIVE',
      restore: { ongoing: false, expiresAt: '2012-12-21T00:00:00.000Z' },
    })
  })

  it('says why a HEAD was refused, from a one-byte GET', async () => {
    const { provider, calls } = recordingProvider((req) =>
      req.method === 'HEAD'
        ? new Response(null, { status: 403, statusText: 'Forbidden' })
        : new Response('<Error><Code>ExpiredToken</Code><Message>The provided token has expired.</Message></Error>', { status: 400 }),
    )
    await expect(provider.head('a')).rejects.toMatchObject({ message: 'Head failed: ExpiredToken (The provided token has expired.)', status: 403 })
    expect(calls.map((c) => [c.method, c.headers.get('range')])).toEqual([['HEAD', null], ['HEAD', null], ['GET', 'bytes=0-0']])
  })

  it('asks again without checksum mode when that is what S3 refuses', async () => {
    const { provider, calls } = recordingProvider((req) =>
      req.headers.get('x-amz-checksum-mode')
        ? new Response(null, { status: 403 })
        : new Response(null, { status: 200, headers: { 'Content-Length': '7', ETag: '"e1"', 'x-amz-storage-class': 'GLACIER_IR' } }),
    )
    expect(await provider.head('a')).toMatchObject({ size: 7, etag: 'e1', storageClass: 'GLACIER_IR', sha256: null })
    expect(calls.map((c) => c.headers.get('x-amz-checksum-mode'))).toEqual(['ENABLED', null])
  })

  it("keeps the HEAD's status when the GET only says the object is archived", async () => {
    const { provider } = recordingProvider((req) =>
      req.method === 'HEAD' ? new Response(null, { status: 403, statusText: 'Forbidden' }) : new Response('<Error><Code>InvalidObjectState</Code></Error>', { status: 403 }),
    )
    await expect(provider.head('a')).rejects.toMatchObject({ message: 'Head failed: HTTP403 (Forbidden)' })
  })

  it('parses an ongoing restore header', () => {
    expect(parseRestoreHeader('ongoing-request="true"')).toEqual({ ongoing: true, expiresAt: null })
    expect(parseRestoreHeader(null)).toBeNull()
  })
})

describe('presigned requests', () => {
  it('signs a part upload in the query string with a short expiry', async () => {
    const { provider, calls } = recordingProvider(ok)
    const signed = await provider.presignPart('big/file.tif', 'UPLOAD123', 3, 900)
    const url = new URL(signed.url)
    expect(signed.method).toBe('PUT')
    expect(url.searchParams.get('partNumber')).toBe('3')
    expect(url.searchParams.get('uploadId')).toBe('UPLOAD123')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(calls).toHaveLength(0)
  })

  it('makes download links that save under the original name', async () => {
    const { provider } = recordingProvider(ok)
    const signed = await provider.presignGet('k', { expiresSeconds: 300, downloadName: 'Bryllup "final" ø.jpg' })
    const disposition = new URL(signed.url).searchParams.get('response-content-disposition')!
    expect(disposition).toBe(attachmentDisposition('Bryllup "final" ø.jpg'))
    expect(disposition).not.toContain('"final"')
  })
})

describe('multipart and listing', () => {
  it('completes with parts in order and quoted ETags', async () => {
    const { provider, calls } = recordingProvider(() => new Response('<CompleteMultipartUploadResult><ETag>"x-2"</ETag></CompleteMultipartUploadResult>'))
    const result = await provider.completeMultipart('k', 'U', [
      { partNumber: 2, etag: 'b' },
      { partNumber: 1, etag: '"a"' },
    ])
    expect(result.etag).toBe('x-2')
    expect(calls[0]!.body).toBe(
      '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"a"</ETag></Part><Part><PartNumber>2</PartNumber><ETag>"b"</ETag></Part></CompleteMultipartUpload>',
    )
  })

  it('lists objects and the continuation token', async () => {
    const xml =
      '<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;1</NextContinuationToken>' +
      '<Contents><Key>a &amp; b.jpg</Key><Size>5</Size><ETag>"e1"</ETag><StorageClass>GLACIER</StorageClass><LastModified>2024-01-02T03:04:05.000Z</LastModified></Contents>' +
      '</ListBucketResult>'
    const { provider, calls } = recordingProvider(() => new Response(xml))
    const page = await provider.list('2024/')
    expect(page).toEqual({
      cursor: 'tok&1',
      objects: [{ key: 'a & b.jpg', size: 5, etag: 'e1', storageClass: 'GLACIER', lastModified: '2024-01-02T03:04:05.000Z' }],
    })
    expect(calls[0]!.url.searchParams.get('prefix')).toBe('2024/')
    expect(calls[0]!.url.searchParams.get('list-type')).toBe('2')
  })
})
