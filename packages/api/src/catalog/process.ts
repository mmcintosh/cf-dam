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
import { getAsset, getLocations, isLabel, primaryLocation, tagStatement } from './assets'
import { applyUploadPresets, iptcUpdate } from './iptc'
import { resolveKeywords } from './keywords'
import { DROP_GPS_PLACES, fillPlacesFromGps } from './places'
import { getLabelNames, type LabelNames } from './library'
import { extractMetadata, METADATA_HEAD_BYTES, RENDERABLE_TYPES, type NormalizedMetadata } from './metadata'
import { generateRenditions, hasRendition, MAX_TRANSFORM_BYTES, storeEmbeddedThumbnail } from './renditions'
import { getAiSettings } from './ai'
import { hashFromThumbnail, recordHashes } from './phash'
import { indexAsset, indexAssets } from './search'
import exifr from 'exifr'

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** What saving metadata looks up first: label names and keyword ids, for any number of photos at once. */
export interface MetadataLookups {
  labels: LabelNames | null
  keywords: Map<string, string>
}

export async function metadataLookups(db: D1Database, metas: NormalizedMetadata[]): Promise<MetadataLookups> {
  return {
    labels: metas.some((m) => m.label) ? await getLabelNames(db) : null,
    keywords: await resolveKeywords(db, metas.flatMap((m) => m.keywords.slice(0, 200))),
  }
}

/** The writes that save a photo's metadata, to run in one batch with others (see metadataLookups). */
export function metadataStatements(db: D1Database, assetId: string, meta: NormalizedMetadata, lookups: MetadataLookups, opts: { fileChanged?: boolean } = {}): D1PreparedStatement[] {
  // Width and height are stored as the photo is seen, upright. Cameras record the sensor's size and an
  // Orientation; 5–8 mean turned a quarter, so a portrait shot's recorded 6000×4000 is really 4000×6000.
  const sideways = meta.orientation !== null && meta.orientation >= 5 && meta.orientation <= 8
  const [width, height] = sideways ? [meta.height, meta.width] : [meta.width, meta.height]
  // xmp:Label holds the label's name; match it against this archive's names, then the colours themselves.
  let label: string | null = null
  if (meta.label && lookups.labels) {
    const wanted = meta.label.toLowerCase()
    const named = Object.entries(lookups.labels).find(([, name]) => name.toLowerCase() === wanted)?.[0] ?? wanted
    if (isLabel(named)) label = named
  }
  // COALESCE keeps anything a person (or the uploading client) already set. When the file itself has
  // changed (re-exported, cropped), what it says about itself replaces the old values: its size, date,
  // camera and place. What people write (title, caption, rating, IPTC, keywords) still only fills gaps.
  const file = (column: string) => (opts.fileChanged ? `${column} = COALESCE(?, ${column})` : `${column} = COALESCE(${column}, ?)`)
  const newValue = (column: string) => (opts.fileChanged ? `COALESCE(?, ${column})` : `COALESCE(${column}, ?)`)
  const statements = [
    // A new position (a file re-sent with other GPS): places looked up from the old one go with it.
    db
      .prepare(`UPDATE assets SET ${DROP_GPS_PLACES} WHERE id = ? AND (${newValue('gps_lat')} IS NOT gps_lat OR ${newValue('gps_lng')} IS NOT gps_lng)`)
      .bind(assetId, meta.gpsLat, meta.gpsLng),
    db
      .prepare(
        `UPDATE assets SET
           ${file('width')}, ${file('height')}, ${file('orientation')},
           ${file('captured_at')}, ${file('captured_offset')},
           ${file('camera_make')}, ${file('camera_model')}, ${file('lens')},
           ${file('focal_length')}, ${file('aperture')},
           ${file('exposure_time')}, ${file('iso')},
           ${file('gps_lat')}, ${file('gps_lng')}, rating = COALESCE(rating, ?),
           title = COALESCE(title, ?), caption = COALESCE(caption, ?), label = COALESCE(label, ?),
           metadata = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        width, height, meta.orientation, meta.capturedAt, meta.capturedOffset,
        meta.cameraMake, meta.cameraModel, meta.lens, meta.focalLength, meta.aperture,
        meta.exposureTime, meta.iso, meta.gpsLat, meta.gpsLng, meta.rating, meta.title, meta.caption, label,
        JSON.stringify(meta.raw), nowIso(), assetId,
      ),
  ]
  if (meta.video) {
    statements.push(
      db
        .prepare(`UPDATE assets SET ${file('duration')}, ${file('video_codec')}, ${file('frame_rate')} WHERE id = ?`)
        .bind(meta.video.duration, meta.video.codec, meta.video.frameRate, assetId),
    )
  }
  const iptc = iptcUpdate(db, assetId, meta.iptc, { fillOnly: true })
  if (iptc) statements.push(iptc)
  const tags = [...new Set(meta.keywords.slice(0, 200).map((k) => lookups.keywords.get(k)).filter((id): id is string => id !== undefined))]
  if (tags.length > 0) statements.push(tagStatement(db, tags.map((id) => [assetId, id] as const), 'import'))
  return statements
}

export async function saveMetadata(db: D1Database, assetId: string, meta: NormalizedMetadata, opts: { fileChanged?: boolean } = {}): Promise<void> {
  await db.batch(metadataStatements(db, assetId, meta, await metadataLookups(db, [meta]), opts))
}

/**
 * The steps every new asset ends with, however its metadata and previews arrived (upload, import or
 * a NAS agent): look-alike hash, presets, places from GPS, AI queue, search index, ready.
 * `hash` is a look-alike hash already computed (by an agent, with the same reducer); otherwise it is
 * computed from the stored thumbnail. `queueAi` is false for an agent's first import of a folder,
 * which could be thousands of photos: those wait for someone to start them on the AI review page.
 * Any number of assets in a fixed number of round trips (the index takes three per 50).
 */
export async function finishAssets(env: DamBindings, items: { id: string; hash?: string | null; queueAi: boolean }[]): Promise<void> {
  if (items.length === 0) return
  const db = env.DB
  const ids = items.map((i) => i.id)
  // A hash it already has (a moved file) stands; otherwise use the one given, or compute it.
  const unhashed = items.filter((i) => !i.hash).map((i) => i.id)
  const { results: existing } = unhashed.length
    ? await db.prepare('SELECT id FROM assets WHERE phash IS NOT NULL AND id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(unhashed)).all<{ id: string }>()
    : { results: [] }
  const hashed = new Set(existing.map((r) => r.id))
  const hashes: { id: string; hash: string }[] = []
  for (const item of items) {
    const hash =
      item.hash ??
      (hashed.has(item.id)
        ? null
        : await hashFromThumbnail(env, item.id).catch((error) => {
            console.warn('[process] could not hash', item.id, error)
            return null
          }))
    if (hash) hashes.push({ id: item.id, hash })
  }
  await recordHashes(db, hashes)

  // Presets marked "apply to new uploads" fill whatever the file left empty; then city and
  // country from GPS where still empty.
  await applyUploadPresets(db, ids)
  await fillPlacesFromGps(env, ids)

  // Queue AI review for those that have a preview; the sweep runs it in the background (a model call takes seconds).
  const forAi = items.filter((i) => i.queueAi).map((i) => i.id)
  if (forAi.length > 0 && env.AI) {
    const settings = await getAiSettings(db)
    if (settings.enabled && settings.auto) {
      await db
        .prepare(
          `UPDATE assets SET ai_status = 'queued' WHERE id IN (SELECT value FROM json_each(?)) AND ai_status IS NULL
             AND EXISTS (SELECT 1 FROM renditions r WHERE r.asset_id = assets.id AND r.name IN ('preview', 'thumb'))`,
        )
        .bind(JSON.stringify(forAi))
        .run()
    }
  }

  await indexAssets(db, ids)
  await db.prepare("UPDATE assets SET status = 'ready', error = NULL, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))").bind(nowIso(), JSON.stringify(ids)).run()
}

export const finishAsset = (env: DamBindings, assetId: string, opts: { hash?: string | null; queueAi: boolean }) => finishAssets(env, [{ id: assetId, ...opts }])

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
