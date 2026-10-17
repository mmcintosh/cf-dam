/**
 * What a file says about itself: EXIF, IPTC and XMP, normalised into the fields people filter on.
 *
 * Reads only the head of the file (metadata lives at the start of JPEG, TIFF and most RAW formats),
 * so it works on a range read of a multi-gigabyte original in S3.
 */
import exifr from 'exifr'
import { iptcFromRaw, type IptcValues } from './iptc'

/** Bytes to read from the start of a file. Enough for EXIF/XMP in JPEG, TIFF and common RAW formats. */
export const METADATA_HEAD_BYTES = 512 * 1024

export interface NormalizedMetadata {
  width: number | null
  height: number | null
  orientation: number | null
  /** The camera's wall clock, e.g. "2024-06-15T18:42:07". EXIF dates carry no zone. */
  capturedAt: string | null
  /** "+02:00" when the camera recorded its UTC offset. */
  capturedOffset: string | null
  cameraMake: string | null
  cameraModel: string | null
  lens: string | null
  focalLength: number | null
  aperture: number | null
  exposureTime: number | null
  iso: number | null
  gpsLat: number | null
  gpsLng: number | null
  rating: number | null
  title: string | null
  caption: string | null
  /** Flat keywords and Lightroom keyword paths ('Places|Norway|Bergen'). */
  keywords: string[]
  /** IPTC Core: creator, rights, contact, place, job. */
  iptc: IptcValues
  /** xmp:Label as written (a colour name, or a custom name from Lightroom's label set). */
  label: string | null
  /** Everything parsed, for the record. Binary values are dropped. */
  raw: Record<string, unknown>
}

type Raw = Record<string, unknown>

const str = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null
  if (value && typeof value === 'object' && 'value' in value) return str((value as { value: unknown }).value)
  return null
}
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** "2024:06:15 18:42:07" → "2024-06-15T18:42:07". */
export function exifDate(value: unknown): string | null {
  const text = str(value)
  const match = text && /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text)
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}` : null
}

/** Degrees/minutes/seconds plus a hemisphere reference → signed decimal degrees. */
export function gpsDecimal(dms: unknown, ref: unknown): number | null {
  if (typeof dms === 'number') return ['S', 'W'].includes(String(ref)) ? -dms : dms
  if (!Array.isArray(dms) || dms.length < 3) return null
  const [d, m, s] = dms.map(Number)
  if (![d, m, s].every((n) => Number.isFinite(n))) return null
  const value = d! + m! / 60 + s! / 3600
  return Math.round((['S', 'W'].includes(String(ref)) ? -value : value) * 1e7) / 1e7
}

const list = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).map(str).filter((t): t is string => t !== null)

/**
 * Keywords from IPTC and XMP. Lightroom's hierarchical keywords ('Places|Norway|Bergen') are kept
 * as paths for the keyword tree; flat keywords already covered by a path (Bergen, Norway) are dropped.
 */
function keywords(raw: Raw): string[] {
  const paths = list(raw.hierarchicalSubject ?? raw.HierarchicalSubject)
  const levels = new Set(paths.flatMap((p) => p.split('|').map((l) => l.trim().toLowerCase())))
  const flat = new Set<string>()
  for (const field of ['Keywords', 'subject', 'Subject']) {
    for (const text of list(raw[field])) for (const part of text.split(/[;,]/)) if (part.trim() && !levels.has(part.trim().toLowerCase())) flat.add(part.trim())
  }
  return [...new Set([...paths, ...flat])].slice(0, 200)
}

function jsonSafe(raw: Raw): Raw {
  const out: Raw = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value instanceof Uint8Array || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue
    if (typeof value === 'string' && value.length > 2000) continue
    out[key] = value
  }
  return out
}

export async function extractMetadata(head: Uint8Array | ArrayBuffer): Promise<NormalizedMetadata | null> {
  let raw: Raw | undefined
  try {
    raw = (await exifr.parse(head, {
      tiff: true,
      exif: true,
      gps: true,
      iptc: true,
      xmp: true,
      icc: false,
      // Keep dates as the camera wrote them; reviving would apply the runtime's local timezone.
      reviveValues: false,
      translateValues: false,
      mergeOutput: true,
    })) as Raw | undefined
  } catch {
    return null
  }
  if (!raw) return null

  const offset = str(raw.OffsetTimeOriginal) ?? str(raw.OffsetTime)
  return {
    width: num(raw.ExifImageWidth) ?? num(raw.ImageWidth) ?? num(raw.PixelXDimension),
    height: num(raw.ExifImageHeight) ?? num(raw.ImageHeight) ?? num(raw.PixelYDimension),
    orientation: num(raw.Orientation),
    capturedAt: exifDate(raw.DateTimeOriginal) ?? exifDate(raw.CreateDate) ?? exifDate(raw.DateTimeDigitized),
    capturedOffset: offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : null,
    cameraMake: str(raw.Make),
    cameraModel: str(raw.Model),
    lens: str(raw.LensModel) ?? str(raw.Lens) ?? str(raw.LensInfo),
    focalLength: num(raw.FocalLength),
    aperture: num(raw.FNumber) ?? num(raw.ApertureValue),
    exposureTime: num(raw.ExposureTime),
    iso: num(raw.ISO) ?? num(raw.ISOSpeedRatings),
    gpsLat: gpsDecimal(raw.GPSLatitude ?? raw.latitude, raw.GPSLatitudeRef),
    gpsLng: gpsDecimal(raw.GPSLongitude ?? raw.longitude, raw.GPSLongitudeRef),
    rating: num(raw.Rating),
    title: str(raw.ObjectName) ?? str(raw.title) ?? str(raw.Headline),
    caption: str(raw.ImageDescription) ?? str(raw.Caption) ?? str(raw.description),
    keywords: keywords(raw),
    iptc: iptcFromRaw(raw),
    label: str(raw.Label),
    raw: jsonSafe(raw),
  }
}

/** Formats Cloudflare Images can decode into renditions. */
export const RENDERABLE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/tiff',
])

/** Types served inline when previewed. Everything else (SVG, HTML, PDF…) is always an attachment. */
export const SAFE_INLINE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
