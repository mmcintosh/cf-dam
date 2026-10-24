/**
 * Look-alike detection: a 64-bit perceptual difference hash (dHash) per photo.
 *
 * The 480 px thumbnail is decoded to pixels, averaged down to 9×8 grey by `areaGrey` (exact area
 * averaging, plain JS), and each of 64 bits is set by whether a pixel is clearly brighter than its
 * right-hand neighbour. Resized, recompressed and lightly edited copies land within a few bits.
 *
 * The reduction is ours, not an image library's, because the NAS agent (sharp) and the Worker
 * (Cloudflare Images) must produce the same hash for the same photo: their resamplers disagree by
 * about 4 bits at 9×8, which cost a quarter of agent-vs-upload matches (spike 5a). Workers have no
 * image decoder, so the Worker asks Images for the thumbnail as PNG (no resizing) and decodes the PNG
 * here: zlib-compressed scanlines, which DecompressionStream handles.
 *
 * Finding neighbours without comparing every pair: each hash is split into BANDS bands. Two hashes
 * within MAX_DISTANCE bits must agree exactly on at least one band (pigeonhole: 5 differing bits can
 * touch at most 5 of 6 bands), so a new photo is checked only against photos sharing a band.
 */
import { countedImages } from '../lib/images'
import type { DamBindings } from '../env'
import { nowIso } from '../lib/time'
import { renditionStore } from '../storage/connections'
import { bands, bitsSet, hamming, hashPixels, isPlain, MAX_ASPECT_DIFFERENCE, MAX_DISTANCE, MIN_DETAIL_BITS, type Decoded } from './dhash'
import { baseKey } from './edits'
import { renditionKey } from './renditions'

export { areaGrey, bands, bitsSet, DEAD_ZONE, dhash, hamming, hashPixels, isPlain, MAX_ASPECT_DIFFERENCE, MAX_DISTANCE, MIN_DETAIL_BITS } from './dhash'

// ── PNG (8-bit, non-interlaced: what Images emits) ────────────────────────────

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * Decode an 8-bit (or, for grey and palette images, 1/2/4-bit) non-interlaced PNG to 8-bit samples.
 * Palette images come back as RGB: Cloudflare Images returns them for some photos.
 */
export async function decodePng(bytes: Uint8Array): Promise<Decoded> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0) !== 0x89504e47) throw new Error('Not a PNG.')
  let offset = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let palette: Uint8Array | null = null
  const idat: Uint8Array[] = []
  while (offset < bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      depth = data[8]!
      colorType = data[9]!
      if (data[12] !== 0) throw new Error('Interlaced PNGs are not supported.')
    } else if (type === 'PLTE') {
      palette = data
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  const lowDepthOk = (colorType === 0 || colorType === 3) && [1, 2, 4].includes(depth)
  if (!channels || (depth !== 8 && !lowDepthOk)) throw new Error(`Unsupported PNG (depth ${depth}, colour type ${colorType}).`)

  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const chunk of idat) {
    joined.set(chunk, at)
    at += chunk.length
  }
  const raw = await inflate(joined)
  // Filters work on bytes: `bpp` bytes per pixel (at least 1), `stride` bytes per scanline.
  const bpp = Math.max(1, (channels * depth) >> 3)
  const stride = Math.ceil((width * channels * depth) / 8)
  const lines = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? lines[y * stride + x - bpp]! : 0
      const up = y > 0 ? lines[(y - 1) * stride + x]! : 0
      const upLeft = y > 0 && x >= bpp ? lines[(y - 1) * stride + x - bpp]! : 0
      const value = line[x]!
      const predicted = filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0
      lines[y * stride + x] = (value + predicted) & 0xff
    }
  }
  // Unpack sub-byte samples (1, 2 or 4 bits) to one byte each; grey scales up to 0–255.
  let samples = lines
  if (depth < 8) {
    samples = new Uint8Array(width * height)
    const max = (1 << depth) - 1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = x * depth
        const v = (lines[y * stride + (bit >> 3)]! >> (8 - depth - (bit & 7))) & max
        samples[y * width + x] = colorType === 0 ? Math.round((v * 255) / max) : v
      }
    }
  }
  if (colorType === 3) {
    if (!palette) throw new Error('Palette PNG without a palette.')
    const rgb = new Uint8Array(width * height * 3)
    for (let i = 0; i < width * height; i++) rgb.set(palette.subarray(samples[i]! * 3, samples[i]! * 3 + 3), i * 3)
    return { width, height, channels: 3, pixels: rgb }
  }
  return { width, height, channels, pixels: samples }
}


/**
 * The look-alike hash of an asset, from its stored thumbnail. Null when it has none or Images is
 * absent. Images only changes the format (WebP → PNG, same size), so the pixels are the thumbnail's.
 * An edited photo is hashed as it was before the edit (as agents hash it), so a crop doesn't hide copies.
 */
export async function hashFromThumbnail(env: DamBindings, assetId: string): Promise<string | null> {
  if (!env.IMAGES) return null
  const store = renditionStore(env)
  const thumb = (await store.get(baseKey(assetId, 'thumb'))) ?? (await store.get(renditionKey(assetId, 'thumb')))
  if (!thumb) return null
  const png = await countedImages(env)!.input(thumb.body).output({ format: 'image/png' })
  return hashPixels(await decodePng(new Uint8Array(await png.response().arrayBuffer())))
}

/** Candidates considered per photo, those sharing the most bands (so the nearest) first. */
const MAX_CANDIDATES = 2000
/** Look-alikes kept per photo, nearest first: a burst of 300 frames isn't 45,000 pairs. */
export const MAX_PAIRS_PER_PHOTO = 50

/**
 * Store each asset's hash and record every look-alike within MAX_DISTANCE (plain ones: see isPlain):
 * three round trips for any number of assets. Returns how many look-alike pairs it found.
 */
export async function recordHashes(db: D1Database, items: { id: string; hash: string }[]): Promise<number> {
  if (items.length === 0) return 0
  const ids = JSON.stringify(items.map((i) => i.id))
  // Hashes too plain to compare are stored, but get no bands: nothing finds them, they find nothing.
  const detailed = items.filter((i) => bitsSet(i.hash) >= MIN_DETAIL_BITS)
  const candidates = await db.batch([
    db
      .prepare("UPDATE assets SET phash = json_extract(j.value, '$[1]') FROM json_each(?) j WHERE assets.id = json_extract(j.value, '$[0]')")
      .bind(JSON.stringify(items.map((i) => [i.id, i.hash]))),
    db.prepare('DELETE FROM asset_hash_bands WHERE asset_id IN (SELECT value FROM json_each(?))').bind(ids),
    db
      .prepare("INSERT INTO asset_hash_bands (asset_id, band, value) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?)")
      .bind(JSON.stringify(detailed.flatMap(({ id, hash }) => bands(hash).map((value, band) => [id, band, value])))),
    // Photos sharing a band with each of these (with these photos among each other too), those sharing
    // the most bands first: they're the nearest, so a cut at MAX_CANDIDATES drops the farthest.
    db
      .prepare(
        `SELECT me, my_width, my_height, id, phash, width, height FROM (
           SELECT me, my_width, my_height, id, phash, width, height, ROW_NUMBER() OVER (PARTITION BY me ORDER BY shared DESC, id) AS n FROM (
             SELECT mine.asset_id AS me, s.width AS my_width, s.height AS my_height, a.id, a.phash, a.width, a.height, COUNT(*) AS shared
             FROM asset_hash_bands mine
             JOIN assets s ON s.id = mine.asset_id
             JOIN asset_hash_bands hb ON hb.band = mine.band AND hb.value = mine.value AND hb.asset_id != mine.asset_id
             JOIN assets a ON a.id = hb.asset_id
             WHERE mine.asset_id IN (SELECT value FROM json_each(?)) AND a.deleted_at IS NULL AND a.phash IS NOT NULL
             GROUP BY mine.asset_id, a.id
           )
         ) WHERE n <= ?`,
      )
      .bind(ids, MAX_CANDIDATES),
    // Plain photos: the same hash and size (idx_assets_phash), the first MAX_PAIRS_PER_PHOTO of each.
    db
      .prepare(
        `SELECT me, id FROM (
           SELECT me.id AS me, a.id, ROW_NUMBER() OVER (PARTITION BY me.id ORDER BY a.id) AS n
           FROM json_each(?) j
           JOIN assets me ON me.id = j.value
           JOIN assets a ON a.phash = me.phash AND a.width = me.width AND a.height = me.height AND a.id != me.id
           WHERE a.deleted_at IS NULL AND a.phash IS NOT NULL AND me.mime_type NOT LIKE 'video/%' AND a.mime_type NOT LIKE 'video/%'
         ) WHERE n <= ?`,
      )
      .bind(JSON.stringify(items.filter((i) => isPlain(i.hash)).map((i) => i.id)), MAX_PAIRS_PER_PHOTO),
  ])
  const hashOf = new Map(items.map((i) => [i.id, i.hash]))
  const ratio = (w: number | null, h: number | null) => (w && h ? w / h : null)
  const near = new Map<string, { other: string; distance: number }[]>()
  for (const r of candidates[3]!.results as { me: string; my_width: number | null; my_height: number | null; id: string; phash: string; width: number | null; height: number | null }[]) {
    // Bands stored before MIN_DETAIL_BITS (0022 removes them; this is belt and braces).
    if (bitsSet(r.phash) < MIN_DETAIL_BITS) continue
    const mine = ratio(r.my_width, r.my_height)
    const other = ratio(r.width, r.height)
    if (mine && other && Math.abs(mine - other) / Math.max(mine, other) > MAX_ASPECT_DIFFERENCE) continue
    const distance = hamming(hashOf.get(r.me)!, r.phash)
    if (distance > MAX_DISTANCE) continue
    near.set(r.me, [...(near.get(r.me) ?? []), { other: r.id, distance }])
  }
  for (const r of candidates[4]!.results as { me: string; id: string }[]) near.set(r.me, [...(near.get(r.me) ?? []), { other: r.id, distance: 0 }])
  const pairs = new Map<string, [string, string, number]>()
  for (const [me, list] of near) {
    for (const { other, distance } of list.sort((x, y) => x.distance - y.distance || x.other.localeCompare(y.other)).slice(0, MAX_PAIRS_PER_PHOTO)) {
      const [a, b] = me < other ? [me, other] : [other, me]
      pairs.set(`${a} ${b}`, [a, b, distance])
    }
  }
  if (pairs.size > 0) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO similar_pairs (a, b, distance, created_at)
         SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), ? FROM json_each(?)`,
      )
      .bind(nowIso(), JSON.stringify([...pairs.values()]))
      .run()
  }
  return pairs.size
}

/** Store one asset's hash and record its look-alikes. Returns how many it found. */
export const recordHash = (db: D1Database, assetId: string, hash: string) => recordHashes(db, [{ id: assetId, hash }])
