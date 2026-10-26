/**
 * Sending an original file: the bytes through the Worker, with byte ranges so a <video> can seek. Always a download
 * unless the type is safe to show inline. The team may get a short-lived presigned link instead, where the store can
 * sign one; clients never do, because the link carries the stored file's name, its object key and the bucket
 * (plans/PLAN-FN-GALLERY-v3.md §3).
 */
import type { AssetRow, LocationRow } from '../catalog/assets'
import { SAFE_INLINE_TYPES } from '../catalog/metadata'
import type { DamBindings } from '../env'
import { cleanOriginal, CLEANABLE_TYPES } from './clean'
import { getConnection, providerFor } from './connections'
import { attachmentDisposition } from './types'

const PLAYABLE_VIDEO: ReadonlySet<string> = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])

export interface OriginalOptions {
  /** The name the download is saved as. */
  downloadName: string
  /** Only for the team: a presigned link where the store can sign one. */
  presign: boolean
  /**
   * For clients: send JPEG and PNG originals cleaned (storage/clean.ts), credited from the catalogue. A file that
   * can't be cleaned throws CleanError before anything is sent. Other types go as stored.
   */
  clean?: boolean
}

/** The response for `asset`'s original at `location`, or null when it isn't there. Storage errors are thrown. */
export async function originalResponse(env: DamBindings, request: Request, asset: AssetRow, location: LocationRow, options: OriginalOptions): Promise<Response | null> {
  const connection = await getConnection(env.DB, location.connection_id)
  if (!connection) return null
  const provider = providerFor(env, connection)
  if (options.presign && provider.presignGet) {
    const signed = await provider.presignGet(location.key, { expiresSeconds: 300, downloadName: options.downloadName })
    return new Response(null, { status: 302, headers: { Location: signed.url, 'Cache-Control': 'private, no-store' } })
  }
  if (options.clean && CLEANABLE_TYPES.has(asset.mime_type)) {
    // Whether the file ends with EOI: with no multi-picture index, the picture then runs to the end (a known length).
    const tail = asset.mime_type === 'image/jpeg' && asset.size >= 4 ? await provider.get(location.key, { offset: asset.size - 2, length: 2 }) : null
    const last = tail ? new Uint8Array(await new Response(tail.body).arrayBuffer()) : null
    const object = await provider.get(location.key)
    if (!object) return null
    const cleaned = await cleanOriginal(object.body, asset.mime_type, asset.size, { creator: asset.creator, copyright: asset.copyright }, last?.[0] === 0xff && last[1] === 0xd9)
    // Whole files only: a cleaned file's bytes don't line up with the stored one's, so ranges aren't offered.
    return new Response(cleaned.body, {
      headers: {
        'Content-Type': asset.mime_type,
        ...(cleaned.length !== null ? { 'Content-Length': String(cleaned.length) } : {}),
        'Content-Disposition': attachmentDisposition(options.downloadName),
        'Cache-Control': 'private, no-store',
      },
    })
  }
  // Byte ranges let a <video> seek without downloading the whole file first.
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('Range') ?? '')
  const start = range ? Number(range[1]) : null
  const end = range?.[2] ? Number(range[2]) : null
  if (start !== null && (start >= asset.size || (end !== null && end < start))) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${asset.size}` } })
  }
  const object = await provider.get(location.key, start === null ? undefined : { offset: start, length: (end === null ? asset.size - 1 : Math.min(end, asset.size - 1)) - start + 1 })
  if (!object) return null
  return new Response(object.body, {
    status: start === null ? 200 : 206,
    headers: {
      // Video can't run script, so it gets its real type (for <video>); other unsafe types stay opaque.
      'Content-Type': SAFE_INLINE_TYPES.has(asset.mime_type) || PLAYABLE_VIDEO.has(asset.mime_type) ? asset.mime_type : 'application/octet-stream',
      'Content-Length': String(object.size),
      'Accept-Ranges': 'bytes',
      ...(start !== null ? { 'Content-Range': `bytes ${start}-${start + object.size - 1}/${asset.size}` } : {}),
      'Content-Disposition': attachmentDisposition(options.downloadName),
      'Cache-Control': 'private, no-store',
    },
  })
}
