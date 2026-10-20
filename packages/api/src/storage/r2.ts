/**
 * R2 through the Worker's own binding: the built-in hot tier, and where renditions always live.
 *
 * The binding can't presign, so large uploads stream through the Worker part by part. R2 has two
 * classes, Standard and Infrequent Access, which map to STANDARD and STANDARD_IA.
 */
import { toHex } from '../lib/crypto'
import {
  StorageError,
  type CompletedPart,
  type ListedObject,
  type ObjectBody,
  type ObjectHead,
  type PutOptions,
  type StorageClass,
  type StorageProvider,
} from './types'

const TO_R2: Partial<Record<StorageClass, string>> = { STANDARD: 'Standard', STANDARD_IA: 'InfrequentAccess' }

function fromR2(storageClass: string | undefined): string {
  return storageClass === 'InfrequentAccess' ? 'STANDARD_IA' : 'STANDARD'
}

function r2Class(options?: PutOptions): string | undefined {
  if (!options?.storageClass) return undefined
  const mapped = TO_R2[options.storageClass]
  if (!mapped) throw new StorageError(`R2 offers Standard and Infrequent Access, not ${options.storageClass}.`, 'InvalidStorageClass')
  return mapped
}

export class R2Provider implements StorageProvider {
  readonly kind = 'r2-binding' as const
  readonly capabilities = {
    presign: false,
    storageClasses: ['STANDARD', 'STANDARD_IA'] as const,
    restore: false,
    changeClass: false,
  }

  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, body: ReadableStream | ArrayBuffer | Uint8Array | string, options?: PutOptions) {
    const object = await this.bucket.put(key, body, {
      httpMetadata: options?.contentType ? { contentType: options.contentType } : undefined,
      storageClass: r2Class(options),
    })
    return { etag: object.etag }
  }

  async head(key: string): Promise<ObjectHead | null> {
    const object = await this.bucket.head(key)
    if (!object) return null
    return {
      size: object.size,
      etag: object.etag,
      contentType: object.httpMetadata?.contentType ?? null,
      storageClass: fromR2(object.storageClass),
      lastModified: object.uploaded.toISOString(),
      restore: null,
      sha256: object.checksums.sha256 ? toHex(object.checksums.sha256) : null,
    }
  }

  async get(key: string, range?: { offset: number; length: number }): Promise<ObjectBody | null> {
    const object = await this.bucket.get(key, range ? { range } : undefined)
    if (!object) return null
    return {
      body: object.body,
      size: range ? Math.min(range.length, Math.max(0, object.size - range.offset)) : object.size,
      contentType: object.httpMetadata?.contentType ?? null,
    }
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key)
  }

  async list(prefix: string, cursor?: string) {
    const page = await this.bucket.list({ prefix, cursor, limit: 1000 })
    const objects: ListedObject[] = page.objects.map((o) => ({
      key: o.key,
      size: o.size,
      etag: o.etag,
      storageClass: fromR2(o.storageClass),
      lastModified: o.uploaded.toISOString(),
    }))
    return { objects, cursor: page.truncated ? page.cursor : null }
  }

  async createMultipart(key: string, options?: PutOptions): Promise<string> {
    const upload = await this.bucket.createMultipartUpload(key, {
      httpMetadata: options?.contentType ? { contentType: options.contentType } : undefined,
      storageClass: r2Class(options),
    })
    return upload.uploadId
  }

  async uploadPart(key: string, uploadId: string, partNumber: number, body: ReadableStream | ArrayBuffer, size: number) {
    const upload = this.bucket.resumeMultipartUpload(key, uploadId)
    // R2 needs a known length for a streamed part. FixedLengthStream is a Workers global; elsewhere
    // (tests under Node) the part is buffered, which proxied part sizes keep bounded.
    const value =
      body instanceof ArrayBuffer
        ? body
        : typeof FixedLengthStream === 'function'
          ? (body.pipeThrough(new FixedLengthStream(size)) as ReadableStream)
          : await new Response(body).arrayBuffer()
    const part = await upload.uploadPart(partNumber, value)
    return { etag: part.etag }
  }

  async completeMultipart(key: string, uploadId: string, parts: CompletedPart[]) {
    const upload = this.bucket.resumeMultipartUpload(key, uploadId)
    // Clients echo ETags as storage returns them in headers, quoted; the binding wants them bare.
    const bare = parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag.replace(/^"|"$/g, '') }))
    const object = await upload.complete(bare.sort((a, b) => a.partNumber - b.partNumber))
    return { etag: object.etag }
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.bucket.resumeMultipartUpload(key, uploadId).abort()
  }

  async test(): Promise<void> {
    const key = '.cf-dam-connection-test'
    await this.bucket.put(key, 'ok')
    if (!(await this.bucket.head(key))) throw new StorageError('Wrote a test object but could not read it back.', 'ProbeMissing')
    await this.bucket.delete(key)
  }
}
