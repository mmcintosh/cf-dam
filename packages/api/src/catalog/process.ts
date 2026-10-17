/**
 * After an original lands: read its metadata, make renditions, index it.
 *
 * Reads only what it needs: a range from the head of the file for metadata, the whole file only when
 * it is small enough to transform and stored somewhere readable (not archived).
 */
import type { DamBindings } from '../env'
import { nowIso } from '../lib/time'
import { getConnection, providerFor } from '../storage/connections'
import { ARCHIVE_CLASSES } from '../storage/types'
import { addTags, getAsset, getLocations, isLabel, primaryLocation } from './assets'
import { applyUploadPresets, iptcUpdate } from './iptc'
import { fillPlacesFromGps } from './places'
import { getLabelNames } from './library'
import { extractMetadata, METADATA_HEAD_BYTES, RENDERABLE_TYPES, type NormalizedMetadata } from './metadata'
import { generateRenditions, hasRendition, MAX_TRANSFORM_BYTES, storeEmbeddedThumbnail } from './renditions'
import { aiAvailable, getAiSettings } from './ai'
import { hashFromThumbnail, recordHash } from './phash'
import { indexAsset } from './search'
import exifr from 'exifr'

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function saveMetadata(db: D1Database, assetId: string, meta: NormalizedMetadata): Promise<void> {
  // COALESCE keeps anything a person (or the uploading client) already set.
  await db
    .prepare(
      `UPDATE assets SET
         width = COALESCE(width, ?), height = COALESCE(height, ?), orientation = COALESCE(orientation, ?),
         captured_at = COALESCE(captured_at, ?), captured_offset = COALESCE(captured_offset, ?),
         camera_make = COALESCE(camera_make, ?), camera_model = COALESCE(camera_model, ?), lens = COALESCE(lens, ?),
         focal_length = COALESCE(focal_length, ?), aperture = COALESCE(aperture, ?),
         exposure_time = COALESCE(exposure_time, ?), iso = COALESCE(iso, ?),
         gps_lat = COALESCE(gps_lat, ?), gps_lng = COALESCE(gps_lng, ?), rating = COALESCE(rating, ?),
         title = COALESCE(title, ?), caption = COALESCE(caption, ?),
         metadata = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      meta.width, meta.height, meta.orientation, meta.capturedAt, meta.capturedOffset,
      meta.cameraMake, meta.cameraModel, meta.lens, meta.focalLength, meta.aperture,
      meta.exposureTime, meta.iso, meta.gpsLat, meta.gpsLng, meta.rating, meta.title, meta.caption,
      JSON.stringify(meta.raw), nowIso(), assetId,
    )
    .run()
  const iptc = iptcUpdate(db, assetId, meta.iptc, { fillOnly: true, locationSource: 'file' })
  if (iptc) await iptc.run()
  // xmp:Label holds the label's name; match it against this archive's names, then the colours themselves.
  if (meta.label) {
    const names = await getLabelNames(db)
    const wanted = meta.label.toLowerCase()
    const label = (Object.entries(names).find(([, name]) => name.toLowerCase() === wanted)?.[0] ?? wanted)
    if (isLabel(label)) await db.prepare('UPDATE assets SET label = COALESCE(label, ?) WHERE id = ?').bind(label, assetId).run()
  }
  if (meta.keywords.length > 0) await addTags(db, assetId, meta.keywords, 'import')
}

/**
 * The steps every new asset ends with, however its metadata and previews arrived (upload, import or
 * a NAS agent): look-alike hash, presets, places from GPS, AI queue, search index, ready.
 * `hash` is a look-alike hash already computed (by an agent, with the same reducer); otherwise it is
 * computed from the stored thumbnail. `queueAi` is false for an agent's first import of a folder,
 * which could be thousands of photos: those wait for someone to start them on the AI review page.
 */
export async function finishAsset(env: DamBindings, assetId: string, opts: { hash?: string | null; queueAi: boolean }): Promise<void> {
  const db = env.DB
  const hash =
    opts.hash ??
    (await hashFromThumbnail(env, assetId).catch((error) => {
      console.warn('[process] could not hash', assetId, error)
      return null
    }))
  if (hash) await recordHash(db, assetId, hash)

  // Presets marked "apply to new uploads" fill whatever the file left empty; then city and
  // country from GPS where still empty.
  await applyUploadPresets(db, assetId)
  await fillPlacesFromGps(env, [assetId])

  // Queue AI review; the sweep runs it in the background (a model call takes seconds).
  if (opts.queueAi) {
    const previewable = (await hasRendition(db, assetId, 'preview')) || (await hasRendition(db, assetId, 'thumb'))
    if (previewable && (await aiAvailable(env)) && (await getAiSettings(db)).auto) {
      await db.prepare("UPDATE assets SET ai_status = 'queued' WHERE id = ? AND ai_status IS NULL").bind(assetId).run()
    }
  }

  await indexAsset(db, assetId)
  await db.prepare("UPDATE assets SET status = 'ready', error = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), assetId).run()
}

export async function processAsset(env: DamBindings, assetId: string): Promise<void> {
  const db = env.DB
  try {
    const asset = await getAsset(db, assetId)
    if (!asset) return
    const location = primaryLocation(await getLocations(db, assetId))
    const connection = location && (await getConnection(db, location.connection_id))
    // Archived originals need a restore first; NAS originals are read by their agent, never here.
    const readable = location && connection && connection.provider !== 'nas' && !ARCHIVE_CLASSES.has(location.storage_class)

    if (readable) {
      const provider = providerFor(env, connection)
      const head = await provider.get(location.key, { offset: 0, length: Math.min(METADATA_HEAD_BYTES, Math.max(asset.size, 1)) })
      const headBytes = head ? await readAll(head.body) : null
      if (headBytes) {
        const meta = await extractMetadata(headBytes, asset.mime_type)
        if (meta) await saveMetadata(db, assetId, meta)
      }

      const needsRenditions = !(await hasRendition(db, assetId, 'preview'))
      if (needsRenditions && RENDERABLE_TYPES.has(asset.mime_type) && asset.size <= MAX_TRANSFORM_BYTES) {
        const original = await provider.get(location.key)
        if (original) {
          const dims = await generateRenditions(env, assetId, original.body)
          if (dims) {
            await db.prepare('UPDATE assets SET width = COALESCE(width, ?), height = COALESCE(height, ?) WHERE id = ?')
              .bind(dims.width, dims.height, assetId).run()
          }
        }
      } else if (needsRenditions && headBytes && !(await hasRendition(db, assetId, 'thumb'))) {
        // RAW and other formats Images can't decode often carry a small JPEG preview in their header.
        const embedded = await exifr.thumbnail(headBytes).catch(() => undefined)
        if (embedded) await storeEmbeddedThumbnail(env, assetId, embedded)
      }
    }

    await finishAsset(env, assetId, { queueAi: true })
  } catch (error) {
    console.error('[process] asset failed', assetId, error)
    await db
      .prepare("UPDATE assets SET status = 'error', error = ?, updated_at = ? WHERE id = ?")
      .bind(error instanceof Error ? error.message.slice(0, 500) : 'Processing failed', nowIso(), assetId)
      .run()
    await indexAsset(db, assetId).catch(() => {})
  }
}
