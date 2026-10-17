/**
 * Storage providers: where original files (and renditions) live.
 *
 * Two implementations share this interface: the R2 binding in the Worker's own account, and any
 * S3 API through aws4fetch (AWS in every storage class, plus S3-compatible services such as
 * Backblaze B2, Wasabi or R2's own S3 endpoint).
 */

/** S3 storage classes, by their `x-amz-storage-class` value. */
export const S3_STORAGE_CLASSES = [
  'STANDARD',
  'INTELLIGENT_TIERING',
  'STANDARD_IA',
  'ONEZONE_IA',
  'GLACIER_IR',
  'GLACIER',
  'DEEP_ARCHIVE',
] as const
export type StorageClass = (typeof S3_STORAGE_CLASSES)[number]

/** Classes whose objects must be restored before they can be read or copied. */
export const ARCHIVE_CLASSES: ReadonlySet<string> = new Set(['GLACIER', 'DEEP_ARCHIVE'])

export const RESTORE_TIERS = ['Expedited', 'Standard', 'Bulk'] as const
export type RestoreTier = (typeof RESTORE_TIERS)[number]

export function isStorageClass(value: unknown): value is StorageClass {
  return typeof value === 'string' && (S3_STORAGE_CLASSES as readonly string[]).includes(value)
}

export interface RestoreStatus {
  /** True while a restore is running. */
  ongoing: boolean
  /** When a completed restore's temporary copy expires (ISO). */
  expiresAt: string | null
}

export interface ObjectHead {
  size: number
  etag: string
  contentType: string | null
  storageClass: string
  lastModified: string | null
  /** Only for archived objects that have had a restore requested. */
  restore: RestoreStatus | null
}

export interface ObjectBody {
  body: ReadableStream<Uint8Array>
  size: number
  contentType: string | null
}

export interface ListedObject {
  key: string
  size: number
  etag: string
  storageClass: string
  lastModified: string | null
}

export interface PutOptions {
  contentType?: string
  storageClass?: StorageClass
}

/** A request the browser or agent sends straight to storage. Signed headers must be sent as given. */
export interface PresignedRequest {
  method: 'GET' | 'PUT'
  url: string
  headers: Record<string, string>
  expiresAt: string
}

export interface CompletedPart {
  partNumber: number
  etag: string
}

export type RestoreResult = 'started' | 'in-progress' | 'already-restored'

export interface StorageCapabilities {
  /** Can sign URLs so clients transfer bytes directly, bypassing the Worker. */
  presign: boolean
  /** Classes an object may be written in or moved to. */
  storageClasses: readonly StorageClass[]
  /** Supports archive restore (GLACIER, DEEP_ARCHIVE). */
  restore: boolean
  /** Can change an existing object's class in place. */
  changeClass: boolean
}

export interface StorageProvider {
  readonly kind: 'r2-binding' | 's3'
  readonly capabilities: StorageCapabilities

  put(key: string, body: ReadableStream | ArrayBuffer | Uint8Array | string, options?: PutOptions): Promise<{ etag: string }>
  head(key: string): Promise<ObjectHead | null>
  get(key: string, range?: { offset: number; length: number }): Promise<ObjectBody | null>
  delete(key: string): Promise<void>
  list(prefix: string, cursor?: string): Promise<{ objects: ListedObject[]; cursor: string | null }>

  createMultipart(key: string, options?: PutOptions): Promise<string>
  /** Upload one part through the Worker (used when the provider can't presign). */
  uploadPart(key: string, uploadId: string, partNumber: number, body: ReadableStream | ArrayBuffer, size: number): Promise<{ etag: string }>
  completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<{ etag: string }>
  abortMultipart(key: string, uploadId: string): Promise<void>

  presignPart?(key: string, uploadId: string, partNumber: number, expiresSeconds: number): Promise<PresignedRequest>
  presignGet?(key: string, options: { expiresSeconds: number; downloadName?: string; contentType?: string }): Promise<PresignedRequest>
  setStorageClass?(key: string, storageClass: StorageClass): Promise<void>
  restore?(key: string, options: { days: number; tier: RestoreTier }): Promise<RestoreResult>

  /** Prove the connection works (credentials, bucket, write access). Throws a readable error. */
  test(): Promise<void>
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'StorageError'
  }
}

/** `Content-Disposition` for a download, with a UTF-8 filename that can't break the header. */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
