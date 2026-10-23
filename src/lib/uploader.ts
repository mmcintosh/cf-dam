/**
 * Browser side of the upload protocol (see packages/api/src/catalog/uploads.ts).
 *
 * Parts go to whatever URL the server hands back: a presigned S3 URL (straight to storage, the
 * Worker never sees the bytes) or this app's own part endpoint (R2 through the Worker). Parts upload
 * three at a time, each retried with backoff. When the original is going somewhere the Worker can't
 * read it back (deep archive) or is too big to transform there, the browser makes the preview itself.
 */
import { t } from '@cf-dam/i18n/client'

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

/** `note`: something worth a quiet word, such as a preview that couldn't be made or sent. */
export type UploadOutcome = { kind: 'uploaded'; assetId: string; note?: string } | { kind: 'duplicate'; assetId: string }

export interface Progress {
  phase: 'hashing' | 'preparing' | 'uploading' | 'finishing'
  sent: number
  total: number
}

const CONCURRENCY = 3
const RETRIES = 4
/** Hashing reads the whole file into memory; above this we skip duplicate detection. */
const MAX_HASH_BYTES = 512 * 1024 * 1024
/** The Worker transforms originals up to about 20 MB (Images' limit: MAX_TRANSFORM_BYTES); above that the browser makes the preview. */
const WORKER_TRANSFORM_LIMIT = 19_800_000
const ARCHIVE_CLASSES = new Set(['GLACIER', 'DEEP_ARCHIVE'])
const BROWSER_DECODABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string }
    throw Object.assign(new Error(body.message ?? body.error ?? t('common.requestFailed', { status: String(response.status) })), { status: response.status, body })
  }
  return (await response.json()) as T
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const hex = (digest: ArrayBuffer) => [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function sha256Hex(file: File): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
}

const MIB = 1024 * 1024

/**
 * The helper's quick fingerprint (packages/agent/src/scan.ts): SHA-256 of the size, the first MiB and
 * the last MiB. Uploads carry it too, so a file is known as the same whether a helper indexed it or
 * someone uploaded it. Reads 2 MiB whatever the size.
 */
export async function quickHash(file: Blob): Promise<string> {
  const head = file.slice(0, Math.min(MIB, file.size))
  const parts: BlobPart[] = [`cf-dam-qh1:${file.size}:`, head]
  if (file.size > MIB) parts.push(file.slice(file.size - Math.min(MIB, file.size - MIB)))
  return hex(await crypto.subtle.digest('SHA-256', await new Blob(parts).arrayBuffer()))
}

/** A WebP no larger than `longEdge` on its longest side, made in the browser. */
async function makeRendition(file: Blob, longEdge: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return encode(canvas, quality)
}

/** WebP, or JPEG where the browser can't write WebP (Safari falls back to PNG, often too big to send). */
async function encode(canvas: OffscreenCanvas, quality: number): Promise<Blob> {
  const webp = await canvas.convertToBlob({ type: 'image/webp', quality })
  return webp.type === 'image/webp' ? webp : canvas.convertToBlob({ type: 'image/jpeg', quality })
}

/** Send a rendition the browser made. False when it didn't arrive: the upload goes on without it. */
async function sendRendition(uploadId: string, name: string, blob: Blob, signal?: AbortSignal): Promise<boolean> {
  try {
    return (await fetch(`/api/uploads/${uploadId}/renditions/${name}`, { method: 'PUT', body: blob, signal })).ok
  } catch (error) {
    if (signal?.aborted) throw error
    return false
  }
}

interface VideoFrames {
  poster: Blob
  sheet: Blob | null
  duration: number
  width: number
  height: number
}

/**
 * The Worker can't decode video, so the browser makes the poster (a frame 10% in) and a 2×2 contact
 * sheet, and reads the length and size. Null when this browser can't play the codec (HEVC in some).
 * The sheet's tiles have the clip's own shape within 480×480, like the agent's (render.ts renderSheet).
 * The element is attached (hidden), muted and inline: iOS Safari loads and seeks a detached video
 * slowly or not at all, and each step gives up after a few seconds rather than stalling the upload.
 */
async function videoFrames(file: File): Promise<VideoFrames | null> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.preload = 'auto'
  video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
  document.body.appendChild(video)
  const once = (event: string, ms: number) =>
    new Promise<void>((resolve, reject) => {
      const done = (fail?: Error) => {
        clearTimeout(timer)
        video.removeEventListener(event, ok)
        video.removeEventListener('error', bad)
        if (fail) reject(fail)
        else resolve()
      }
      const ok = () => done()
      const bad = () => done(new Error('unplayable'))
      const timer = setTimeout(() => done(new Error('timeout')), ms)
      video.addEventListener(event, ok)
      video.addEventListener('error', bad)
    })
  try {
    const loaded = once('loadeddata', 8_000)
    video.src = url
    // iOS may not decode a frame until asked to play; muted and inline, it is allowed to.
    void video.play().then(() => video.pause(), () => {})
    await loaded
    const { duration, videoWidth: width, videoHeight: height } = video
    if (!width || !height || !Number.isFinite(duration)) return null
    const grab = async (at: number, w: number, h: number) => {
      const seeked = once('seeked', 5_000)
      video.currentTime = at
      await seeked
      const canvas = new OffscreenCanvas(w, h)
      canvas.getContext('2d')!.drawImage(video, 0, 0, w, h)
      return canvas
    }
    const posterScale = Math.min(1, 2048 / Math.max(width, height))
    const poster = await encode(await grab(duration * 0.1, Math.round(width * posterScale), Math.round(height * posterScale)), 0.82)
    const tileScale = 480 / Math.max(width, height)
    const [tw, th] = [Math.max(1, Math.round(width * tileScale)), Math.max(1, Math.round(height * tileScale))]
    // The sheet is a bonus: without it the video still has its poster.
    const sheet = await (async () => {
      const sheetCanvas = new OffscreenCanvas(tw * 2, th * 2)
      const ctx = sheetCanvas.getContext('2d')!
      for (const [i, f] of [0.2, 0.4, 0.6, 0.8].entries()) ctx.drawImage(await grab(duration * f, tw, th), (i % 2) * tw, Math.floor(i / 2) * th)
      return encode(sheetCanvas, 0.78)
    })().catch(() => null)
    return { poster, sheet, duration, width, height }
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
    video.remove()
    URL.revokeObjectURL(url)
  }
}

/** PUT one part with upload progress (fetch can't report it), returning the storage ETag. */
function putPart(target: PartTarget, body: Blob, onSent: (bytes: number) => void, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', target.url)
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (event) => onSent(event.loaded)
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(Object.assign(new Error(t('upload.partFailed', { part: target.partNumber, status: String(xhr.status) })), { status: xhr.status }))
      const etag = xhr.getResponseHeader('ETag')
      if (!etag) {
        return reject(new Error(t('upload.noEtag')))
      }
      resolve(etag)
    }
    xhr.onerror = () => reject(new Error(t('upload.networkPart', { part: target.partNumber })))
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
  const quick = await quickHash(file)

  const createdResponse = await post('/api/uploads', {
    filename: file.name,
    size: file.size,
    contentType: file.type,
    sha256,
    quickHash: quick,
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
    // Previews the browser makes are sent first, but a failure with one never stops the original.
    let note: string | undefined
    const isVideo = file.type.startsWith('video/')
    const video = isVideo ? await videoFrames(file) : null
    if (video) {
      const thumb = await makeRendition(video.poster, 480, 0.78).catch(() => null)
      const renditions: [string, Blob | null][] = [['preview', video.poster], ['thumb', thumb], ['sheet', video.sheet]]
      for (const [name, blob] of renditions) {
        if (blob && !(await sendRendition(created.uploadId, name, blob, signal)) && name === 'preview') note = t('upload.noPreview')
      }
    } else if (isVideo) {
      note = t('upload.noPreviewVideo')
    }
    const workerCannotRead = ARCHIVE_CLASSES.has(created.storageClass) || file.size > WORKER_TRANSFORM_LIMIT
    if (workerCannotRead && BROWSER_DECODABLE.has(file.type)) {
      for (const [name, edge, quality] of [['preview', 2048, 0.82], ['thumb', 480, 0.78]] as const) {
        const blob = await makeRendition(file, edge, quality).catch(() => null)
        if ((!blob || !(await sendRendition(created.uploadId, name, blob, signal))) && name === 'preview') note = t('upload.noPreview')
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
        video: video ? { duration: video.duration, width: video.width, height: video.height } : undefined,
      }),
    )
    return { kind: 'uploaded', assetId: done.assetId, note }
  } catch (error) {
    await fetch(`/api/uploads/${created.uploadId}`, { method: 'DELETE' }).catch(() => {})
    throw error
  }
}
