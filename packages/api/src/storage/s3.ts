/**
 * S3 provider on aws4fetch: AWS S3 in every storage class, and any S3-compatible service.
 *
 * Requests are signed with SigV4 by aws4fetch and sent with an injectable `fetch`, so tests can
 * record exactly what goes over the wire. Presigned URLs let browsers and the NAS agent move bytes
 * straight to S3; the Worker only signs and records.
 */
import { AwsClient } from 'aws4fetch'
import {
  ARCHIVE_CLASSES,
  attachmentDisposition,
  S3_STORAGE_CLASSES,
  StorageError,
  type CompletedPart,
  type ListedObject,
  type ObjectBody,
  type ObjectHead,
  type PresignedRequest,
  type PutOptions,
  type RestoreResult,
  type RestoreStatus,
  type RestoreTier,
  type StorageClass,
  type StorageProvider,
} from './types'
import { escapeXml, xmlBlocks, xmlValue } from './xml'

export interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export interface S3Config {
  /** e.g. `https://s3.us-east-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com`, `http://localhost:9000`. */
  endpoint: string
  region: string
  bucket: string
  /** Path-style (`endpoint/bucket/key`) instead of virtual-hosted (`bucket.endpoint/key`). Most non-AWS services need it. */
  forcePathStyle?: boolean
  /** Classes this connection offers. AWS supports all; most S3-compatible services only STANDARD. */
  storageClasses?: readonly StorageClass[]
  /** Credentials, resolved per call so temporary (STS) credentials can refresh. */
  credentials: () => Promise<AwsCredentials>
  fetch?: typeof fetch
}

/** Single objects above this go through multipart copy, which S3 requires past 5 GiB. */
const MAX_SINGLE_COPY = 5 * 1024 ** 3
const PROBE_KEY = '.cf-dam-connection-test'

/** Percent-encode each path segment of an object key, keeping the slashes. */
export function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

/** Parse `x-amz-restore: ongoing-request="false", expiry-date="Fri, 21 Dec 2012 00:00:00 GMT"`. */
export function parseRestoreHeader(value: string | null): RestoreStatus | null {
  if (!value) return null
  const ongoing = /ongoing-request="true"/i.test(value)
  const expiry = /expiry-date="([^"]+)"/i.exec(value)?.[1]
  const expiresAt = expiry ? new Date(expiry) : null
  return { ongoing, expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null }
}

function stripQuotes(etag: string | null): string {
  return (etag ?? '').replace(/^"|"$/g, '')
}

/**
 * The origin a bucket's URLs have: the endpoint's for path-style, `bucket.` in front of its host for
 * virtual-hosted. Browsers PUT and GET presigned URLs there, so the page's CSP names it.
 */
export function bucketOrigin(config: { endpoint: string; bucket: string; forcePathStyle?: boolean }): string {
  const base = new URL(config.endpoint)
  return config.forcePathStyle ? base.origin : `${base.protocol}//${config.bucket}.${base.host}`
}

export class S3Provider implements StorageProvider {
  readonly kind = 's3' as const
  readonly capabilities

  private readonly fetchImpl: typeof fetch
  private readonly base: URL

  constructor(private readonly config: S3Config) {
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init))
    this.base = new URL(config.endpoint)
    const classes = config.storageClasses ?? ['STANDARD']
    this.capabilities = {
      presign: true,
      storageClasses: classes,
      restore: classes.some((c) => ARCHIVE_CLASSES.has(c)),
      changeClass: classes.length > 1,
    }
  }

  /** The object (or bucket, when `key` is empty) URL, with optional query parameters. */
  url(key: string, query: Record<string, string> = {}): URL {
    const path = key ? `/${encodeKey(key)}` : '/'
    const origin = bucketOrigin(this.config)
    const url = this.config.forcePathStyle
      ? new URL(`${origin}${this.base.pathname.replace(/\/$/, '')}/${encodeURIComponent(this.config.bucket)}${path}`)
      : new URL(`${origin}${this.base.pathname.replace(/\/$/, '')}${path}`)
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
    return url
  }

  private async client(): Promise<AwsClient> {
    const credentials = await this.config.credentials()
    // Retries are ours to decide (and visible in tests); aws4fetch's default is 10.
    return new AwsClient({ ...credentials, service: 's3', region: this.config.region, retries: 0 })
  }

  private async send(method: string, url: URL, init: { headers?: Record<string, string>; body?: BodyInit | null } = {}): Promise<Response> {
    const client = await this.client()
    const signed = await client.sign(url.toString(), { method, headers: init.headers, body: init.body ?? null })
    return this.fetchImpl(signed)
  }

  private async fail(response: Response, action: string): Promise<never> {
    const text = await response.text().catch(() => '')
    const code = xmlValue(text, 'Code') ?? `HTTP${response.status}`
    const message = xmlValue(text, 'Message') ?? response.statusText
    throw new StorageError(`${action} failed: ${code}${message ? ` (${message})` : ''}`, code, response.status)
  }

  private classHeaders(options?: PutOptions): Record<string, string> {
    const headers: Record<string, string> = {}
    if (options?.contentType) headers['Content-Type'] = options.contentType
    if (options?.storageClass && options.storageClass !== 'STANDARD') {
      if (!this.capabilities.storageClasses.includes(options.storageClass)) {
        throw new StorageError(`This connection does not offer ${options.storageClass}.`, 'InvalidStorageClass')
      }
      headers['x-amz-storage-class'] = options.storageClass
    }
    return headers
  }

  async put(key: string, body: ReadableStream | ArrayBuffer | Uint8Array | string, options?: PutOptions) {
    const response = await this.send('PUT', this.url(key), { headers: this.classHeaders(options), body: body as BodyInit })
    if (!response.ok) await this.fail(response, 'Upload')
    return { etag: stripQuotes(response.headers.get('ETag')) }
  }

  async head(key: string): Promise<ObjectHead | null> {
    const response = await this.send('HEAD', this.url(key))
    if (response.status === 404) return null
    if (!response.ok) await this.fail(response, 'Head')
    const modified = response.headers.get('Last-Modified')
    return {
      size: Number(response.headers.get('Content-Length') ?? 0),
      etag: stripQuotes(response.headers.get('ETag')),
      contentType: response.headers.get('Content-Type'),
      // S3 omits the header for STANDARD.
      storageClass: response.headers.get('x-amz-storage-class') ?? 'STANDARD',
      lastModified: modified ? new Date(modified).toISOString() : null,
      restore: parseRestoreHeader(response.headers.get('x-amz-restore')),
    }
  }

  async get(key: string, range?: { offset: number; length: number }): Promise<ObjectBody | null> {
    const headers: Record<string, string> = {}
    if (range) headers.Range = `bytes=${range.offset}-${range.offset + range.length - 1}`
    const response = await this.send('GET', this.url(key), { headers })
    if (response.status === 404) return null
    if (response.status === 403) {
      const text = await response.clone().text()
      if (xmlValue(text, 'Code') === 'InvalidObjectState') {
        throw new StorageError('The original is archived. Restore it first.', 'InvalidObjectState', 403)
      }
    }
    if (!response.ok || !response.body) await this.fail(response, 'Download')
    return {
      body: response.body!,
      size: Number(response.headers.get('Content-Length') ?? 0),
      contentType: response.headers.get('Content-Type'),
    }
  }

  async delete(key: string): Promise<void> {
    const response = await this.send('DELETE', this.url(key))
    if (!response.ok && response.status !== 404) await this.fail(response, 'Delete')
  }

  async list(prefix: string, cursor?: string) {
    const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000' }
    if (prefix) query.prefix = prefix
    if (cursor) query['continuation-token'] = cursor
    const response = await this.send('GET', this.url('', query))
    if (!response.ok) await this.fail(response, 'List')
    const xml = await response.text()
    const objects: ListedObject[] = xmlBlocks(xml, 'Contents').map((block) => {
      const modified = xmlValue(block, 'LastModified')
      return {
        key: xmlValue(block, 'Key') ?? '',
        size: Number(xmlValue(block, 'Size') ?? 0),
        etag: stripQuotes(xmlValue(block, 'ETag')),
        storageClass: xmlValue(block, 'StorageClass') ?? 'STANDARD',
        lastModified: modified ? new Date(modified).toISOString() : null,
      }
    })
    const truncated = xmlValue(xml, 'IsTruncated') === 'true'
    return { objects, cursor: truncated ? xmlValue(xml, 'NextContinuationToken') : null }
  }

  async createMultipart(key: string, options?: PutOptions): Promise<string> {
    const response = await this.send('POST', this.url(key, { uploads: '' }), { headers: this.classHeaders(options) })
    if (!response.ok) await this.fail(response, 'Starting a multipart upload')
    const uploadId = xmlValue(await response.text(), 'UploadId')
    if (!uploadId) throw new StorageError('S3 returned no UploadId.', 'NoUploadId')
    return uploadId
  }

  async uploadPart(key: string, uploadId: string, partNumber: number, body: ReadableStream | ArrayBuffer, size: number) {
    const response = await this.send('PUT', this.url(key, { partNumber: String(partNumber), uploadId }), {
      headers: { 'Content-Length': String(size) },
      body: body as BodyInit,
    })
    if (!response.ok) await this.fail(response, `Uploading part ${partNumber}`)
    return { etag: stripQuotes(response.headers.get('ETag')) }
  }

  async completeMultipart(key: string, uploadId: string, parts: CompletedPart[]) {
    const body =
      '<CompleteMultipartUpload>' +
      [...parts]
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${escapeXml(stripQuotes(p.etag))}"</ETag></Part>`)
        .join('') +
      '</CompleteMultipartUpload>'
    const response = await this.send('POST', this.url(key, { uploadId }), { headers: { 'Content-Type': 'application/xml' }, body })
    const text = await response.text()
    // S3 can answer 200 with an <Error> body when completion fails late.
    if (!response.ok || xmlValue(text, 'Code')) {
      const code = xmlValue(text, 'Code') ?? `HTTP${response.status}`
      throw new StorageError(`Completing the upload failed: ${code}`, code, response.status)
    }
    return { etag: stripQuotes(xmlValue(text, 'ETag')) }
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    const response = await this.send('DELETE', this.url(key, { uploadId }))
    if (!response.ok && response.status !== 404) await this.fail(response, 'Aborting the upload')
  }

  private async presign(method: 'GET' | 'PUT', url: URL, expiresSeconds: number, headers: Record<string, string> = {}): Promise<PresignedRequest> {
    url.searchParams.set('X-Amz-Expires', String(expiresSeconds))
    const client = await this.client()
    const signed = await client.sign(url.toString(), { method, headers, aws: { signQuery: true } })
    return { method, url: signed.url, headers, expiresAt: new Date(Date.now() + expiresSeconds * 1000).toISOString() }
  }

  presignPart(key: string, uploadId: string, partNumber: number, expiresSeconds: number) {
    return this.presign('PUT', this.url(key, { partNumber: String(partNumber), uploadId }), expiresSeconds)
  }

  presignGet(key: string, options: { expiresSeconds: number; downloadName?: string; contentType?: string }) {
    const query: Record<string, string> = {}
    if (options.downloadName) query['response-content-disposition'] = attachmentDisposition(options.downloadName)
    if (options.contentType) query['response-content-type'] = options.contentType
    return this.presign('GET', this.url(key, query), options.expiresSeconds)
  }

  async setStorageClass(key: string, storageClass: StorageClass): Promise<void> {
    if (!this.capabilities.storageClasses.includes(storageClass)) {
      throw new StorageError(`This connection does not offer ${storageClass}.`, 'InvalidStorageClass')
    }
    const current = await this.head(key)
    if (!current) throw new StorageError('The object does not exist.', 'NoSuchKey', 404)
    if (current.storageClass === storageClass) return
    if (ARCHIVE_CLASSES.has(current.storageClass) && !(current.restore && !current.restore.ongoing)) {
      throw new StorageError('The object is archived. Restore it before changing its class.', 'InvalidObjectState', 403)
    }
    if (current.size > MAX_SINGLE_COPY) {
      throw new StorageError('Objects over 5 GiB need a multipart copy, which is not supported yet.', 'EntityTooLarge')
    }
    const response = await this.send('PUT', this.url(key), {
      headers: {
        'x-amz-copy-source': `/${encodeURIComponent(this.config.bucket)}/${encodeKey(key)}`,
        'x-amz-metadata-directive': 'COPY',
        'x-amz-storage-class': storageClass,
      },
    })
    const text = await response.text()
    if (!response.ok || xmlValue(text, 'Code')) {
      const code = xmlValue(text, 'Code') ?? `HTTP${response.status}`
      throw new StorageError(`Changing the storage class failed: ${code}`, code, response.status)
    }
  }

  async restore(key: string, options: { days: number; tier: RestoreTier }): Promise<RestoreResult> {
    const body =
      '<RestoreRequest xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
      `<Days>${Math.max(1, Math.floor(options.days))}</Days>` +
      `<GlacierJobParameters><Tier>${options.tier}</Tier></GlacierJobParameters>` +
      '</RestoreRequest>'
    const response = await this.send('POST', this.url(key, { restore: '' }), { headers: { 'Content-Type': 'application/xml' }, body })
    if (response.status === 202) return 'started'
    if (response.status === 200) return 'already-restored'
    const text = await response.text()
    if (response.status === 409 && xmlValue(text, 'Code') === 'RestoreAlreadyInProgress') return 'in-progress'
    const code = xmlValue(text, 'Code') ?? `HTTP${response.status}`
    throw new StorageError(`Restore failed: ${code}`, code, response.status)
  }

  async test(): Promise<void> {
    const marker = `ok ${new Date().toISOString()}`
    await this.put(PROBE_KEY, marker, { contentType: 'text/plain' })
    const head = await this.head(PROBE_KEY)
    if (!head) throw new StorageError('Wrote a test object but could not read it back.', 'ProbeMissing')
    await this.delete(PROBE_KEY)
  }
}

export { S3_STORAGE_CLASSES }
