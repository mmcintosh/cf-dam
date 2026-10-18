/**
 * Reading a photo with ExifTool: its metadata, in the shape cf-dam's Worker stores
 * (normalizeAgentMetadata in packages/api/src/catalog/metadata.ts), and the image to make previews from.
 *
 * Previews (spike 5a): JPEG/PNG/TIFF are their own source, read from the file by sharp. HEIC goes
 * through libheif's converter (or sips on a Mac): prebuilt sharp reads only AVIF. RAW files carry an embedded JPEG; the
 * largest is found by its group-qualified offset and length and read straight from the file (5 ms; a
 * maker-note thumbnail also called PreviewImage can't shadow it). CR3, RAF and RW2 record no offsets,
 * so ExifTool extracts the preview to a temp file instead.
 */
import { ExifTool, type Tags } from 'exiftool-vendored'
import { execFile, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { isVideo } from './scan.ts'

const run = promisify(execFile)
/** Optional helpers, found once: LibRaw for RAWs with tiny previews, ffmpeg for video frames, a HEIC converter. */
const has = (cmd: string) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).error === undefined
const heicTool = (): 'sips' | 'heif-dec' | 'heif-convert' | null =>
  process.platform === 'darwin' && has('sips') ? 'sips' : has('heif-dec') ? 'heif-dec' : has('heif-convert') ? 'heif-convert' : null
export const TOOLS = { dcrawEmu: has('dcraw_emu'), ffmpeg: has('ffmpeg'), heic: heicTool() }
/** Prebuilt sharp has libheif without an HEVC decoder (AVIF only); a sharp built on a full libvips may have one. */
const SHARP_READS_HEIC = sharp.format.heif?.input.fileSuffix?.includes('.heic') ?? false

/** A helper that hangs (a damaged file, a share gone quiet) is killed rather than holding up the scan. */
const TIMEOUT = { dcrawEmu: 120_000, ffmpegFrame: 60_000, heic: 120_000 }

/**
 * ffmpeg one frame at a time across all workers: decoding a 4K HEVC frame takes ~300 MB, and five at
 * once per video, three videos at once, was enough to run a 1 GB container out of memory.
 */
let ffmpegTurn: Promise<unknown> = Promise.resolve()
function oneFfmpegAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const mine = ffmpegTurn.then(fn, fn)
  ffmpegTurn = mine.catch(() => undefined)
  return mine
}

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
  video: { duration: number | null; codec: string | null; frameRate: number | null } | null
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
    video: null,
  }
}

/** '0:01:23', '83.4 s', 83.4 → seconds. */
export function seconds(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string') return null
  const hms = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v.trim())
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3])
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : null
}

const CODECS: Record<string, string> = { avc1: 'h264', hvc1: 'hevc', hev1: 'hevc', ap4h: 'prores', apch: 'prores', apcn: 'prores', apcs: 'prores', apco: 'prores', av01: 'av1', vp09: 'vp9' }

/**
 * Video metadata. QuickTime's CreationDate (phones) carries the local time and offset; CreateDate is
 * meant to be UTC but many cameras write local time, so it's taken as a wall clock with no offset.
 */
export function mapVideo(t: T): AgentMetadata {
  const meta = mapTags(t)
  const creation = typeof rawValue(t.CreationDate) === 'string' ? (rawValue(t.CreationDate) as string) : null
  const offset = creation && /([+-]\d{2}:\d{2})$/.exec(creation)?.[1]
  const compressor = str(t.CompressorID)?.toLowerCase() ?? null
  return {
    ...meta,
    capturedAt: exifDate(creation) ?? meta.capturedAt,
    capturedOffset: offset ?? meta.capturedOffset,
    width: num(t.ImageWidth) ?? meta.width,
    height: num(t.ImageHeight) ?? meta.height,
    // ffmpeg turns frames upright itself; the size is the stored one, rotated by the Rotation tag.
    orientation: [90, 270].includes(num(t.Rotation) ?? 0) ? 6 : 1,
    video: {
      duration: seconds(t.Duration) ?? seconds(t.MediaDuration),
      codec: (compressor && CODECS[compressor]) ?? str(t.VideoCodec) ?? compressor,
      frameRate: num(t.VideoFrameRate),
    },
  }
}

/** Formats sharp decodes directly; everything else is treated as RAW. */
const DIRECT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.avif', '.gif'])
const HEIC = new Set(['.heic', '.heif'])
/** Embedded-image tags, largest-first by convention; the actual choice is by length. */
const EMBEDDED = ['JpgFromRaw', 'PreviewImage', 'OtherImage', 'ThumbnailImage']

export interface Extracted {
  meta: AgentMetadata
  /**
   * The image to render previews from: the file's own path (sharp reads it as it goes, so a 45 MP
   * TIFF isn't held in memory twice), or encoded bytes (a RAW's preview, a video frame); null if none.
   */
  source: Buffer | string | null
  /** The orientation to apply if `source` carries none (a RAW's, for its embedded preview); null when already upright. */
  orientation: number | null
  /** False when `source`'s own orientation tag is not to be followed (a converted HEIC's may be stale). */
  ownOrientation?: false
  /** Videos: four frames for the contact sheet (when ffmpeg is installed). */
  frames?: Buffer[]
}

/** Below this long edge an embedded preview is too small to be the photo's preview; LibRaw decodes the RAW instead. */
const MIN_PREVIEW_EDGE = 1024

export class Extractor {
  readonly exiftool: ExifTool
  private readonly tmp = mkdtempSync(join(tmpdir(), 'cf-dam-agent-'))

  constructor(processes = 1) {
    this.exiftool = new ExifTool({ maxProcs: processes, taskTimeoutMillis: 60_000 })
  }

  async extract(path: string): Promise<Extracted> {
    const tags = (await this.exiftool.read(path)) as Tags & T
    if (isVideo(path)) return this.video(path, tags)
    const meta = mapTags(tags)
    const ext = extname(path).toLowerCase()
    if (DIRECT.has(ext) || (HEIC.has(ext) && SHARP_READS_HEIC)) return { meta, source: path, orientation: meta.orientation }
    if (HEIC.has(ext)) {
      // The converters apply the HEIF's own rotation (irot), which is what counts; the EXIF tag copied
      // into their output may say the same again. Without an irot, the EXIF orientation is the one.
      return { meta, source: await this.heic(path), orientation: 'Rotation' in tags ? null : meta.orientation, ownOrientation: false }
    }
    const embedded = await this.embedded(path, tags)
    if (TOOLS.dcrawEmu) {
      const size = embedded ? await sharp(embedded).metadata().catch(() => null) : null
      if (!size || Math.max(size.width ?? 0, size.height ?? 0) < MIN_PREVIEW_EDGE) {
        // Half-size decode (~0.5 s): white-balanced, already turned upright by LibRaw.
        const decoded = await run('dcraw_emu', ['-h', '-w', '-T', '-Z', '-', path], {
          encoding: 'buffer',
          maxBuffer: 512 * 1024 * 1024,
          timeout: TIMEOUT.dcrawEmu,
          killSignal: 'SIGKILL',
        }).catch(() => null)
        if (decoded && decoded.stdout.length > 0) return { meta, source: decoded.stdout, orientation: null }
      }
    }
    return { meta, source: embedded, orientation: meta.orientation }
  }

  /**
   * HEIC → JPEG in a temp folder, by libheif's heif-dec/heif-convert or macOS's sips. (A file holding
   * several images makes heif-convert number its outputs; the primary comes first.)
   */
  private async heic(path: string): Promise<Buffer> {
    if (!TOOLS.heic) throw new Error('Reading HEIC needs libheif (heif-dec) on this computer.')
    const dir = mkdtempSync(join(this.tmp, 'heic-'))
    const out = join(dir, 'out.jpg')
    try {
      const args = TOOLS.heic === 'sips' ? ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', path, '--out', out] : ['-q', '92', path, out]
      await run(TOOLS.heic, args, { timeout: TIMEOUT.heic, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
      const written = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
      if (written.length === 0) throw new Error('The HEIC converter wrote no image.')
      return readFileSync(join(dir, written.includes('out.jpg') ? 'out.jpg' : written[0]!))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /** A poster frame at 10% in, and four frames for the sheet, when ffmpeg is here; metadata either way. */
  private async video(path: string, tags: T): Promise<Extracted> {
    const meta = mapVideo(tags)
    if (!TOOLS.ffmpeg) return { meta, source: null, orientation: null }
    const duration = meta.video?.duration ?? 0
    // One decoding thread: frames are small, and threads multiply ffmpeg's memory.
    const frameAt = async (at: number, width: number): Promise<Buffer | null> => {
      const out = await oneFfmpegAtATime(() =>
        run(
          'ffmpeg',
          ['-nostdin', '-v', 'error', '-threads', '1', '-ss', at.toFixed(2), '-i', path, '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', '-'],
          { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT.ffmpegFrame, killSignal: 'SIGKILL' },
        ),
      ).catch(() => null)
      return out && out.stdout.length > 0 ? out.stdout : null
    }
    const poster = await frameAt(duration * 0.1, 2048)
    const frames: Buffer[] = []
    for (const f of duration > 0 && poster ? [0.2, 0.4, 0.6, 0.8] : []) {
      const frame = await frameAt(duration * f, 480)
      if (frame) frames.push(frame)
    }
    return { meta, source: poster, orientation: null, frames: frames.length === 4 ? frames : undefined }
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
