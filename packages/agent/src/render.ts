/**
 * Previews and the look-alike hash, with sharp. Upright, sRGB, metadata stripped (GPS stays in cf-dam's
 * database, never in served images). WebP at effort 2: the same size as the default effort 4 and about
 * four times faster to encode (spike 5a).
 */
import { hashPixels } from '@cf-dam/api/dhash'
import sharp from 'sharp'

sharp.concurrency(1) // one libvips thread per photo; the agent runs several photos at once instead
sharp.cache(false)

export const PREVIEW = { longEdge: 2048, quality: 82 }
export const THUMB = { longEdge: 480, quality: 78 }
/** A contact sheet tile's long edge: the sheet is two tiles each way (cf-dam takes up to 960). */
const SHEET_TILE = 480
const ROTATE: Record<number, number> = { 3: 180, 6: 90, 8: 270 }

export interface Rendered {
  preview: Buffer
  thumb: Buffer
  phash: string
  width: number
  height: number
  /** Videos: four frames in a 2×2 grid. */
  sheet?: Buffer
}

/**
 * Four video frames in a 2×2 grid, each the clip's own shape within 480×480 (a portrait clip's tiles
 * are portrait): the library flips through them on hover, each quarter filling a tile of the thumb's
 * shape, so nothing is cropped or squeezed. The browser uploader makes the same grid.
 */
export async function renderSheet(frames: Buffer[]): Promise<Buffer> {
  const first = await sharp(frames[0]!).metadata()
  const scale = SHEET_TILE / Math.max(first.width ?? SHEET_TILE, first.height ?? SHEET_TILE)
  const w = Math.max(1, Math.round((first.width ?? SHEET_TILE) * scale))
  const h = Math.max(1, Math.round((first.height ?? SHEET_TILE) * scale))
  const tiles = await Promise.all(frames.map((f) => sharp(f).resize(w, h, { fit: 'contain', background: '#000' }).toBuffer()))
  return sharp({ create: { width: w * 2, height: h * 2, channels: 3, background: '#000' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % 2) * w, top: Math.floor(i / 2) * h })))
    .webp({ quality: 78, effort: 2 })
    .toBuffer()
}

/**
 * `source`: a file's path or encoded bytes. `fallbackOrientation`: the RAW's own Orientation, for an
 * embedded preview that has none. `ownOrientation: false` ignores the source's tag and uses the fallback.
 */
export async function render(source: Buffer | string, fallbackOrientation: number | null = null, ownOrientation = true): Promise<Rendered> {
  let image = sharp(source, { sequentialRead: true, failOn: 'none' })
  const own = ownOrientation ? (await image.metadata()).orientation : undefined
  image = own && own !== 1 ? image.rotate() : fallbackOrientation && ROTATE[fallbackOrientation] ? image.rotate(ROTATE[fallbackOrientation]) : image
  const preview = await image
    .toColourspace('srgb')
    .resize(PREVIEW.longEdge, PREVIEW.longEdge, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: PREVIEW.quality, effort: 2 })
    .toBuffer({ resolveWithObject: true })
  // The thumb from the preview, not the original: half the decoding, the same result at 480 px.
  const thumb = await sharp(preview.data).resize(THUMB.longEdge, THUMB.longEdge, { fit: 'inside', withoutEnlargement: true }).webp({ quality: THUMB.quality, effort: 2 }).toBuffer()
  // The hash from the thumb's decoded pixels, through the reducer the Worker uses.
  const { data, info } = await sharp(thumb).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const phash = hashPixels({ width: info.width, height: info.height, channels: info.channels, pixels: new Uint8Array(data) })
  return { preview: preview.data, thumb, phash, width: preview.info.width, height: preview.info.height }
}
