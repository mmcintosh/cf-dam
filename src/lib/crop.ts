/**
 * The crop box's geometry for the rotate-and-crop editor. A crop is in shares (0–1) of the picture as
 * rotated and mirrored (packages/api/src/catalog/edits.ts), and `frame` is that picture's size in
 * pixels, needed wherever an aspect ratio is kept.
 */
export interface Crop {
  x: number
  y: number
  width: number
  height: number
}
export interface Frame {
  width: number
  height: number
}

export const FULL: Crop = { x: 0, y: 0, width: 1, height: 1 }
/** The smallest crop, as a share of each side (as the API allows). */
export const MIN = 0.02

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** The same part of the picture after turning it a quarter clockwise. */
export const turnClockwise = (c: Crop): Crop => ({ x: 1 - c.y - c.height, y: c.x, width: c.height, height: c.width })
/** The same part of the picture after turning it a quarter anticlockwise. */
export const turnAnticlockwise = (c: Crop): Crop => ({ x: c.y, y: 1 - c.x - c.width, width: c.height, height: c.width })
/** The same part of the picture after mirroring it left to right. */
export const mirror = (c: Crop): Crop => ({ ...c, x: 1 - c.x - c.width })

/** The largest crop of `ratio` (width / height, in pixels) centred on `around` (the whole picture by default). */
export function fitRatio(frame: Frame, ratio: number, around: Crop = FULL): Crop {
  const cx = around.x + around.width / 2
  const cy = around.y + around.height / 2
  // In shares: width share × frame width / (height share × frame height) = ratio.
  let width = 1
  let height = (frame.width / ratio) / frame.height
  if (height > 1) {
    height = 1
    width = (ratio * frame.height) / frame.width
  }
  return { x: clamp(cx - width / 2, 0, 1 - width), y: clamp(cy - height / 2, 0, 1 - height), width, height }
}

export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move'

/**
 * The crop after dragging `handle` by (dx, dy) shares, from where it was when the drag began. A corner
 * moves while the opposite corner stays put; with a `ratio`, the height follows the width.
 */
export function drag(start: Crop, handle: Handle, dx: number, dy: number, frame: Frame, ratio: number | null): Crop {
  if (handle === 'move') {
    return { ...start, x: clamp(start.x + dx, 0, 1 - start.width), y: clamp(start.y + dy, 0, 1 - start.height) }
  }
  const west = handle === 'nw' || handle === 'sw'
  const north = handle === 'nw' || handle === 'ne'
  // The fixed corner, and how far the box may grow from it.
  const fx = west ? start.x + start.width : start.x
  const fy = north ? start.y + start.height : start.y
  const roomX = west ? fx : 1 - fx
  const roomY = north ? fy : 1 - fy
  let width = clamp(start.width + (west ? -dx : dx), MIN, roomX)
  let height = clamp(start.height + (north ? -dy : dy), MIN, roomY)
  if (ratio) {
    // Keep the ratio, following the width, and shrink both when the height runs out of room.
    height = (width * frame.width) / ratio / frame.height
    if (height > roomY) {
      height = roomY
      width = (height * frame.height * ratio) / frame.width
    }
    if (height < MIN || width < MIN) return start
  }
  return { x: west ? fx - width : fx, y: north ? fy - height : fy, width, height }
}

/** Whether a crop is the whole picture, near enough. */
export const isFull = (c: Crop) => c.x < 1e-4 && c.y < 1e-4 && c.width > 1 - 1e-4 && c.height > 1 - 1e-4
