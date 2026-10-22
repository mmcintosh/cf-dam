/**
 * Rotate, mirror and crop, without touching the original.
 *
 * An edit is a few numbers on the asset (`assets.edit`). The thumbnail and preview people see are
 * made from the unedited ones, which are kept beside them (`baseKey`), so an edit can be changed or
 * undone at any time and the original file, wherever it lives, is never written to. Whatever makes a
 * thumbnail or preview later (an agent re-sending one, previews made again after a restore) goes
 * through `store()` in renditions.ts, which applies the photo's edit there too.
 *
 * The steps run in a fixed order, each its own Images transform so the order is certain: rotate
 * (clockwise), then mirror (left to right), then crop. The crop is in shares (0–1) of the rotated,
 * mirrored picture, the frame people draw it on, so it fits a preview of any size and the original.
 */
import type { RenditionName } from './renditions'

export const ROTATIONS = [0, 90, 180, 270] as const
export type Rotation = (typeof ROTATIONS)[number]

export interface Crop {
  x: number
  y: number
  width: number
  height: number
}

export interface ImageEdit {
  rotate: Rotation
  mirror: boolean
  crop: Crop | null
}

/** The smallest crop, as a share of each side: below this a preview would be a few pixels. */
export const MIN_CROP = 0.02
/** Rounding slack when a crop is checked against the frame's edges. */
const SLACK = 1e-6

export const baseKey = (assetId: string, name: RenditionName) => `renditions/${assetId}/${name}-base.webp`

/** An edit as sent by a page or stored, or null for none. Throws on nonsense. */
export function parseEdit(value: unknown): ImageEdit | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('An edit is an object with rotate, mirror and crop.')
  const v = value as Record<string, unknown>
  const rotate = v.rotate ?? 0
  if (!(ROTATIONS as readonly unknown[]).includes(rotate)) throw new TypeError('rotate must be 0, 90, 180 or 270.')
  const mirror = v.mirror ?? false
  if (typeof mirror !== 'boolean') throw new TypeError('mirror must be true or false.')
  let crop: Crop | null = null
  if (v.crop !== null && v.crop !== undefined) {
    const c = v.crop as Record<string, unknown>
    const [x, y, width, height] = [c.x, c.y, c.width, c.height].map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : NaN))
    if ([x, y, width, height].some(Number.isNaN)) throw new TypeError('crop needs x, y, width and height, as numbers.')
    if (x! < -SLACK || y! < -SLACK || width! < MIN_CROP || height! < MIN_CROP || x! + width! > 1 + SLACK || y! + height! > 1 + SLACK) {
      throw new TypeError('crop must lie inside the picture: x, y, width and height are shares of it, from 0 to 1.')
    }
    const share = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1e6) / 1e6
    crop = { x: share(x!), y: share(y!), width: share(width!), height: share(height!) }
    // The whole picture is no crop.
    if (crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1) crop = null
  }
  const edit: ImageEdit = { rotate: rotate as Rotation, mirror, crop }
  return edit.rotate === 0 && !edit.mirror && !edit.crop ? null : edit
}

/** The stored edit, or null (a bad one, which shouldn't happen, counts as none). */
export function readEdit(stored: string | null | undefined): ImageEdit | null {
  if (!stored) return null
  try {
    return parseEdit(JSON.parse(stored))
  } catch {
    return null
  }
}

export async function getEdit(db: D1Database, assetId: string): Promise<ImageEdit | null> {
  const row = await db.prepare('SELECT edit FROM assets WHERE id = ?').bind(assetId).first<{ edit: string | null }>()
  return readEdit(row?.edit)
}

/** The size of a `width` × `height` picture once edited. */
export function editedSize(width: number, height: number, edit: ImageEdit | null): { width: number; height: number } {
  if (!edit) return { width, height }
  const [w, h] = edit.rotate % 180 === 0 ? [width, height] : [height, width]
  const box = cropBox(w, h, edit.crop)
  return { width: box.width, height: box.height }
}

/** The crop in pixels of a `width` × `height` picture (already rotated and mirrored). */
export function cropBox(width: number, height: number, crop: Crop | null): { left: number; top: number; width: number; height: number } {
  if (!crop) return { left: 0, top: 0, width, height }
  const left = Math.min(width - 1, Math.round(crop.x * width))
  const top = Math.min(height - 1, Math.round(crop.y * height))
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(crop.width * width))),
    height: Math.max(1, Math.min(height - top, Math.round(crop.height * height))),
  }
}

/**
 * Apply an edit to a picture of known size: the rotate and mirror steps, then the crop. Returns the
 * transformer, for the caller to resize, watermark or output, and the edited size.
 */
export function editImage(images: ImagesBinding, input: ReadableStream, size: { width: number; height: number }, edit: ImageEdit) {
  let image = images.input(input)
  if (edit.rotate) image = image.transform({ rotate: edit.rotate })
  if (edit.mirror) image = image.transform({ flip: 'h' })
  const [w, h] = edit.rotate % 180 === 0 ? [size.width, size.height] : [size.height, size.width]
  const box = cropBox(w, h, edit.crop)
  if (edit.crop) image = image.transform({ trim: { left: box.left, top: box.top, width: box.width, height: box.height } })
  return { image, width: box.width, height: box.height }
}

/** Part of an image address that changes with every edit, so browsers fetch the new picture. */
export const imageVersion = (editedAt: string | null | undefined) => (editedAt ? editedAt.replace(/\D/g, '') : '0')
