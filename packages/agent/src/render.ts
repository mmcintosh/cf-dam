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
const ROTATE: Record<number, number> = { 3: 180, 6: 90, 8: 270 }

export interface Rendered {
  preview: Buffer
  thumb: Buffer
  phash: string
  width: number
  height: number
}

/** `fallbackOrientation`: the RAW's own Orientation, for an embedded preview that has none. */
export async function render(source: Buffer, fallbackOrientation: number | null = null): Promise<Rendered> {
  let image = sharp(source, { sequentialRead: true, failOn: 'none' })
  const own = (await image.metadata()).orientation
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
