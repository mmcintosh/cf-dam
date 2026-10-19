/**
 * Sending an original file: a short-lived presigned link where the store can sign one, otherwise the
 * bytes through the Worker, with byte ranges so a <video> can seek. Always a download unless the type
 * is safe to show inline.
 */
import type { AssetRow, LocationRow } from '../catalog/assets'
import { SAFE_INLINE_TYPES } from '../catalog/metadata'
import type { DamBindings } from '../env'
import { getConnection, providerFor } from './connections'
import { attachmentDisposition } from './types'

const PLAYABLE_VIDEO: ReadonlySet<string> = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])

/** The response for `asset`'s original at `location`, or null when it isn't there. Storage errors are thrown. */
export async function originalResponse(env: DamBindings, request: Request, asset: AssetRow, location: LocationRow): Promise<Response | null> {
  const connection = await getConnection(env.DB, location.connection_id)
  if (!connection) return null
  const provider = providerFor(env, connection)
  if (provider.presignGet) {
    const signed = await provider.presignGet(location.key, { expiresSeconds: 300, downloadName: asset.filename })
    return new Response(null, { status: 302, headers: { Location: signed.url, 'Cache-Control': 'private, no-store' } })
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
      'Content-Disposition': attachmentDisposition(asset.filename),
      'Cache-Control': 'private, no-store',
    },
  })
}
