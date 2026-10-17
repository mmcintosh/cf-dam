/**
 * Browser side of the upload protocol (see packages/api/src/catalog/uploads.ts).
 *
 * Parts go to whatever URL the server hands back: a presigned S3 URL (straight to storage, the
 * Worker never sees the bytes) or this app's own part endpoint (R2 through the Worker). Parts upload
 * three at a time, each retried with backoff. When the original is going somewhere the Worker can't
 * read it back (deep archive) or is too big to transform there, the browser makes the preview itself.
 */

export interface UploadTarget {
  connectionId?: string
  storageClass?: string
}

export interface PartTarget {
  partNumber: number
  method: 'PUT'
  url: string
  headers: Record<string, string>
  size: number
}

export type UploadOutcome = { kind: 'uploaded'; assetId: string } | { kind: 'duplicate'; assetId: string }

export interface Progress {
  phase: 'hashing' | 'preparing' | 'uploading' | 'finishing'
  sent: number
  total: number
}

const CONCURRENCY = 3
const RETRIES = 4
/** Hashing reads the whole file into memory; above this we skip duplicate detection. */
const MAX_HASH_BYTES = 512 * 1024 * 1024
/** The Worker transforms originals up to 70 MB; above that the browser makes the preview. */
const WORKER_TRANSFORM_LIMIT = 70 * 1024 * 1024
const ARCHIVE_CLASSES = new Set(['GLACIER', 'DEEP_ARCHIVE'])
const BROWSER_DECODABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string }
    throw Object.assign(new Error(body.message ?? body.error ?? `Request failed (${response.status})`), { status: response.status, body })
  }
  return (await response.json()) as T
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A WebP no larger than `longEdge` on its longest side, made in the browser. */
async function makeRendition(file: File, longEdge: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.convertToBlob({ type: 'image/webp', quality })
}

/** PUT one part with upload progress (fetch can't report it), returning the storage ETag. */
function putPart(target: PartTarget, body: Blob, onSent: (bytes: number) => void, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', target.url)
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (event) => onSent(event.loaded)
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(Object.assign(new Error(`Part ${target.partNumber} failed (${xhr.status})`), { status: xhr.status }))
      const etag = xhr.getResponseHeader('ETag')
      if (!etag) {
        return reject(new Error('Storage did not expose the ETag header. Add ETag to the bucket CORS rule’s ExposeHeaders.'))
      }
      resolve(etag)
    }
    xhr.onerror = () => reject(new Error(`Network error on part ${target.partNumber}. If this is an S3 bucket, check its CORS rule allows PUT from this site.`))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    xhr.send(body)
  })
}

async function withRetries<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      const status = (error as { status?: number }).status
      const retryable = status === undefined || status >= 500 || status === 429
      if (signal?.aborted || !retryable || attempt >= RETRIES) throw error
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250))
    }
  }
}

export async function uploadFile(
  file: File,
  target: UploadTarget,
  onProgress: (progress: Progress) => void,
  signal?: AbortSignal,
): Promise<UploadOutcome> {
  onProgress({ phase: 'hashing', sent: 0, total: file.size })
  const sha256 = file.size <= MAX_HASH_BYTES ? await sha256Hex(file) : undefined

  const createdResponse = await post('/api/uploads', {
    filename: file.name,
    size: file.size,
    contentType: file.type,
    sha256,
    connectionId: target.connectionId,
    storageClass: target.storageClass,
  })
  if (createdResponse.status === 409) {
    const body = (await createdResponse.clone().json().catch(() => ({}))) as { error?: string; duplicateOf?: string }
    if (body.error === 'duplicate' && body.duplicateOf) return { kind: 'duplicate', assetId: body.duplicateOf }
  }
  const created = await json<{ uploadId: string; assetId: string; partCount: number; storageClass: string }>(createdResponse)

  try {
    onProgress({ phase: 'preparing', sent: 0, total: file.size })
    const workerCannotRead = ARCHIVE_CLASSES.has(created.storageClass) || file.size > WORKER_TRANSFORM_LIMIT
    if (workerCannotRead && BROWSER_DECODABLE.has(file.type)) {
      for (const [name, edge, quality] of [['preview', 2048, 0.82], ['thumb', 480, 0.78]] as const) {
        const blob = await makeRendition(file, edge, quality).catch(() => null)
        if (blob) await fetch(`/api/uploads/${created.uploadId}/renditions/${name}`, { method: 'PUT', body: blob, signal })
      }
    }

    const sentByPart = new Map<number, number>()
    const report = () => onProgress({ phase: 'uploading', sent: [...sentByPart.values()].reduce((a, b) => a + b, 0), total: file.size })
    const numbers = Array.from({ length: created.partCount }, (_, i) => i + 1)
    const etags = new Map<number, string>()
    let next = 0

    // Part URLs are fetched in batches as uploading reaches them, so presigned ones don't expire.
    const targets = new Map<number, PartTarget>()
    async function targetFor(partNumber: number): Promise<PartTarget> {
      if (!targets.has(partNumber)) {
        const batch = numbers.slice(partNumber - 1, partNumber - 1 + 50)
        const { parts } = await json<{ parts: PartTarget[] }>(await post(`/api/uploads/${created.uploadId}/part-urls`, { partNumbers: batch }))
        for (const part of parts) targets.set(part.partNumber, part)
      }
      return targets.get(partNumber)!
    }

    // Every part but the last has the same size, so part 1's size gives every offset.
    const partSize = (await targetFor(1)).size
    async function worker() {
      while (next < numbers.length) {
        const partNumber = numbers[next++]!
        const start = (partNumber - 1) * partSize
        const blob = file.slice(start, Math.min(start + partSize, file.size))
        const etag = await withRetries(async () => {
          sentByPart.set(partNumber, 0)
          return putPart(await targetFor(partNumber), blob, (sent) => {
            sentByPart.set(partNumber, sent)
            report()
          }, signal)
        }, signal)
        sentByPart.set(partNumber, blob.size)
        report()
        etags.set(partNumber, etag)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, numbers.length) }, worker))

    onProgress({ phase: 'finishing', sent: file.size, total: file.size })
    const done = await json<{ assetId: string }>(
      await post(`/api/uploads/${created.uploadId}/complete`, {
        parts: numbers.map((partNumber) => ({ partNumber, etag: etags.get(partNumber)! })),
      }),
    )
    return { kind: 'uploaded', assetId: done.assetId }
  } catch (error) {
    await fetch(`/api/uploads/${created.uploadId}`, { method: 'DELETE' }).catch(() => {})
    throw error
  }
}
