/**
 * Reading a photo with ExifTool: its metadata, in the shape cf-dam's Worker stores
 * (normalizeAgentMetadata in packages/api/src/catalog/metadata.ts), and the image to make previews from.
 *
 * Previews (spike 5a): JPEG/PNG/TIFF/HEIC are their own source. RAW files carry an embedded JPEG; the
 * largest is found by its group-qualified offset and length and read straight from the file (5 ms; a
 * maker-note thumbnail also called PreviewImage can't shadow it). CR3, RAF and RW2 record no offsets,
 * so ExifTool extracts the preview to a temp file instead.
 */
import { ExifTool, type Tags } from 'exiftool-vendored'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

export interface AgentMetadata {
  width: number | null
  height: number | null
  orientation: number | null
  capturedAt: string | null
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
  /** Flat keywords, plus Lightroom paths ('Places|Norway|Bergen') for the keyword tree. */
  keywords: string[]
  iptc: Record<string, string | null>
  label: string | null
}

type T = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' ? v.trim() || null : typeof v === 'number' ? String(v) : null)
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string') return null
  const frac = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/.exec(v.trim())
  if (frac) return Number(frac[1]) / Number(frac[2])
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const list = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(str).filter((s): s is string => s !== null)
/** exiftool-vendored wraps dates; we want the camera's wall clock as written. */
const rawValue = (v: unknown): unknown => (v && typeof v === 'object' && 'rawValue' in v ? (v as { rawValue: unknown }).rawValue : v)

export function exifDate(v: unknown): string | null {
  const m = typeof v === 'string' && /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v)
  return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null
}

const LENS_JUNK = /^[\d\s.]+$/ // numeric lens codes ("2 30 10") are not names

/** ExifTool tags → cf-dam's metadata shape. Mirrors the Worker's exifr mapping field for field. */
export function mapTags(t: T): AgentMetadata {
  const offset = str(t.OffsetTimeOriginal) ?? str(t.OffsetTime)
  // Keyword paths stay whole; flat keywords that are just levels of a path are dropped (as the Worker does).
  const paths = list(t.HierarchicalSubject)
  const levels = new Set(paths.flatMap((p) => p.split('|').map((l) => l.trim().toLowerCase())))
  const flat = [...list(t.Keywords), ...list(t.Subject)].filter((k) => !levels.has(k.toLowerCase()))
  const lens = [t.LensModel, t.LensID, t.Lens, t.LensType].map(str).find((l) => l && !LENS_JUNK.test(l)) ?? null
  // The developed size: DNG/Sony DefaultCropSize, Fuji RawImageCroppedSize, else the EXIF size.
  const pair = (v: unknown) => {
    const n = Array.isArray(v) ? v.map(Number) : typeof v === 'string' ? v.split(/[\sx]+/).map(Number) : []
    return n.length >= 2 && n.every(Number.isFinite) ? n.slice(-2) : null
  }
  const crop = pair(t.DefaultCropSize) ?? pair(t.RawImageCroppedSize)
  const r7 = (n: number | null) => (n === null ? null : Math.round(n * 1e7) / 1e7)
  const contact = (key: string) => str(t[key]) ?? str((t.CreatorContactInfo as T | undefined)?.[key])
  return {
    width: crop?.[0] ?? num(t.ExifImageWidth) ?? num(t.ImageWidth),
    height: crop?.[1] ?? num(t.ExifImageHeight) ?? num(t.ImageHeight),
    orientation: num(t.Orientation),
    capturedAt: exifDate(rawValue(t.DateTimeOriginal)) ?? exifDate(rawValue(t.CreateDate)) ?? exifDate(rawValue(t.DateTimeDigitized)),
    capturedOffset: offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : null,
    cameraMake: str(t.Make),
    cameraModel: str(t.Model),
    lens,
    focalLength: num(t.FocalLength),
    aperture: num(t.FNumber) ?? num(t.Aperture),
    exposureTime: num(t.ExposureTime),
    iso: num(t.ISO),
    gpsLat: r7(num(t.GPSLatitude)),
    gpsLng: r7(num(t.GPSLongitude)),
    rating: num(t.Rating),
    title: str(t.ObjectName) ?? str(t.Title) ?? str(t.Headline),
    caption: str(t.ImageDescription) ?? str(t['Caption-Abstract']) ?? str(t.Description),
    keywords: [...new Set([...paths, ...flat])].slice(0, 200),
    iptc: {
      headline: str(t.Headline),
      // IPTC By-line first, as the Worker does: ExifTool can report an XMP Creator echoing the EXIF Artist.
      creator: str(t['By-line']) ?? str(list(t.Creator)[0]) ?? str(t.Artist),
      creatorTitle: str(t.AuthorsPosition) ?? str(t['By-lineTitle']),
      credit: str(t.Credit),
      source: str(t.Source),
      copyright: str(t.Rights) ?? str(t.CopyrightNotice) ?? str(t.Copyright),
      usageTerms: str(t.UsageTerms),
      copyrightUrl: str(t.WebStatement),
      contactEmail: contact('CreatorWorkEmail') ?? contact('CiEmailWork'),
      contactPhone: contact('CreatorWorkTelephone') ?? contact('CiTelWork'),
      contactUrl: contact('CreatorWorkURL') ?? contact('CiUrlWork'),
      jobId: str(t.TransmissionReference) ?? str(t.OriginalTransmissionReference),
      instructions: str(t.Instructions) ?? str(t.SpecialInstructions),
      sublocation: str(t.Location) ?? str(t['Sub-location']),
      city: str(t.City),
      state: str(t.State) ?? str(t['Province-State']),
      country: str(t.Country) ?? str(t['Country-PrimaryLocationName']),
      countryCode: str(t.CountryCode) ?? str(t['Country-PrimaryLocationCode']),
    },
    label: str(t.Label),
  }
}

/** Formats sharp decodes directly; everything else is treated as RAW. */
const DIRECT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.avif', '.gif', '.heic', '.heif'])
/** Embedded-image tags, largest-first by convention; the actual choice is by length. */
const EMBEDDED = ['JpgFromRaw', 'PreviewImage', 'OtherImage', 'ThumbnailImage']

export interface Extracted {
  meta: AgentMetadata
  /** Encoded image (JPEG or the file itself) to render previews from, or null if there is none. */
  source: Buffer | null
  /** The RAW's own orientation, for embedded previews that carry none. */
  orientation: number | null
}

export class Extractor {
  readonly exiftool: ExifTool
  private readonly tmp = mkdtempSync(join(tmpdir(), 'cf-dam-agent-'))

  constructor(processes = 1) {
    this.exiftool = new ExifTool({ maxProcs: processes, taskTimeoutMillis: 60_000 })
  }

  async extract(path: string): Promise<Extracted> {
    const tags = (await this.exiftool.read(path)) as Tags & T
    const meta = mapTags(tags)
    if (DIRECT.has(extname(path).toLowerCase())) return { meta, source: readFileSync(path), orientation: meta.orientation }
    return { meta, source: await this.embedded(path, tags), orientation: meta.orientation }
  }

  private async embedded(path: string, tags: T): Promise<Buffer | null> {
    const offsets = (await this.exiftool.readRaw(path, ['-n', '-G1', '-a', ...EMBEDDED.flatMap((t) => [`-${t}Start`, `-${t}Length`])])) as T
    let best: { start: number; length: number } | null = null
    for (const [key, length] of Object.entries(offsets)) {
      if (!key.endsWith('Length') || typeof length !== 'number') continue
      const start = offsets[key.replace(/Length$/, 'Start')]
      if (typeof start === 'number' && (!best || length > best.length)) best = { start, length }
    }
    if (best && best.length > 0) {
      const handle = await open(path, 'r')
      try {
        const buf = Buffer.alloc(best.length)
        await handle.read(buf, 0, best.length, best.start)
        if (buf[0] === 0xff && buf[1] === 0xd8) return buf // a JPEG, as expected
      } finally {
        await handle.close()
      }
    }
    // CR3, RAF, RW2 (no offsets), or offsets that didn't point at a JPEG: let ExifTool extract it.
    for (const tag of EMBEDDED) {
      if (!(tag in tags)) continue
      const dest = join(this.tmp, `${process.pid}-${Math.random().toString(36).slice(2)}.jpg`)
      try {
        await this.exiftool.extractBinaryTag(tag, path, dest)
        const buf = readFileSync(dest)
        if (buf.length > 0) return buf
      } catch {
        // try the next tag
      } finally {
        rmSync(dest, { force: true })
      }
    }
    return null
  }

  async end(): Promise<void> {
    await this.exiftool.end()
    rmSync(this.tmp, { recursive: true, force: true })
  }
}
