/**
 * A face chip: a square that shows one found face, cut from a rendition with CSS backgrounds (no image is made). A box is
 * in per-mille (0–1000) of the photo (packages/api/src/catalog/faces.ts). The detector's boxes are tight, brow to chin,
 * so the chip shows a margin round each: some hair, ears and chin. The larger view on the photo page uses a wider
 * margin (head and shoulders) with the chip's part outlined in it: the whole head, not just brow to chin.
 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The chip's margin on each side, as a share of the box's own width or height. */
export const MARGIN = 0.3
/** The larger view's margin: three times the face's width, head and shoulders. */
export const WIDE = 1

/**
 * The box with its margin, moved back inside the photo where it would run off an edge. Near a photo's size the margin
 * shrinks on both sides alike, so the face is never squashed.
 */
export function withMargin(b: Box, margin = MARGIN): Box {
  const grow = Math.min(1 + 2 * margin, 1000 / b.w, 1000 / b.h)
  const place = (at: number, size: number) => {
    const wide = size * grow
    return [Math.min(1000 - wide, Math.max(0, at - (wide - size) / 2)), wide] as const
  }
  const [x, w] = place(b.x, b.w)
  const [y, h] = place(b.y, b.h)
  return { x, y, w, h }
}

/** The style that fills a chip with the box and its margin: the picture scaled so that is the chip's size, moved so it is in it. */
export function chipStyle(src: string, face: Box, margin = MARGIN): string {
  const b = withMargin(face, margin)
  const at = (pos: number, size: number) => (size >= 1000 ? 0 : (pos / (1000 - size)) * 100)
  return `background-image:url(${src});background-size:${(1000 / b.w) * 100}% ${(1000 / b.h) * 100}%;background-position:${at(b.x, b.w)}% ${at(b.y, b.h)}%`
}

/** Where the face, with the chip's margin, sits in a view cut with `margin`: a style for an outline laid over it. */
export function outlineStyle(face: Box, margin = WIDE): string {
  const b = withMargin(face, margin)
  const head = withMargin(face, MARGIN)
  return `left:${((head.x - b.x) / b.w) * 100}%;top:${((head.y - b.y) / b.h) * 100}%;width:${(head.w / b.w) * 100}%;height:${(head.h / b.h) * 100}%`
}
