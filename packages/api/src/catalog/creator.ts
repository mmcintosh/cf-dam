/**
 * Which of a file's three "who took this" fields to believe. Shared with the NAS helper, so no imports.
 *
 * - XMP `dc:creator` is the current standard and wins, as the Metadata Working Group's guidance has it.
 * - Except when it only repeats the EXIF Artist (a camera, or a tool that copies Artist into XMP) while
 *   the IPTC By-line says someone else: the By-line was typed on purpose, so it wins there.
 * - Otherwise whichever is there: XMP, then the By-line, then the EXIF Artist.
 */
export function pickCreator(xmp: string | null, byline: string | null, artist: string | null): string | null {
  const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0
  if (xmp && byline && artist && !same(xmp, byline) && same(xmp, artist)) return byline
  return xmp ?? byline ?? artist
}
