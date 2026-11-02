/**
 * A face chip: a square that shows one found face, cut from a rendition with CSS backgrounds (no image is made). A box is
 * in per-mille (0–1000) of the photo (packages/api/src/catalog/faces.ts). The detector's boxes are tight, brow to chin,
 * so the chip shows a margin round each: some hair, ears and chin.
 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The margin on each side, as a share of the box's own width or height. */
export const MARGIN = 0.3

/** The box with its margin, moved back inside the photo where it would run off an edge, so the face isn't squashed. */
export function withMargin(b: Box, margin = MARGIN): Box {
  const grow = (at: number, size: number) => {
    const wide = Math.min(1000, size * (1 + 2 * margin))
    return [Math.min(1000 - wide, Math.max(0, at - size * margin)), wide] as const
  }
  const [x, w] = grow(b.x, b.w)
  const [y, h] = grow(b.y, b.h)
  return { x, y, w, h }
}

/** The style that fills a chip with the box and its margin: the picture scaled so that is the chip's size, moved so it is in it. */
export function chipStyle(src: string, face: Box): string {
  const b = withMargin(face)
  const at = (pos: number, size: number) => (size >= 1000 ? 0 : (pos / (1000 - size)) * 100)
  return `background-image:url(${src});background-size:${(1000 / b.w) * 100}% ${(1000 / b.h) * 100}%;background-position:${at(b.x, b.w)}% ${at(b.y, b.h)}%`
}
