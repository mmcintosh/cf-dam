/**
 * Cleaning an original as a client downloads it (plans/PLAN-FN-GALLERY-v3.md §3, G0b): what goes out is the picture,
 * the camera's settings and the photographer's credit, not the names, captions, keywords, places and private notes
 * that cameras and editing software write into files.
 *
 * Allow-lists, never block-lists: a part of the file that isn't known to be safe is dropped. Only the head is read
 * into memory (up to HEAD_CAP); the image data streams through untouched. A file that can't be cleaned with
 * certainty throws CleanError before anything is sent, and is never sent as stored instead.
 *
 * JPEG: SOI, APP0 (JFIF), APP1 Exif (cleaned in place, same length, so no offsets move), APP2 ICC, APP14 (Adobe) and
 * the image markers are kept; XMP, IPTC (APP13), comments, C2PA (APP11) and everything else go. A new, minimal XMP
 * holds the creator and copyright notice from the catalogue. The file ends at the first image's EOI: the second
 * pictures of multi-picture files (MPF, Ultra HDR gain maps, phone trailers) carry their own metadata and are dropped.
 *
 * PNG: chunks are walked by length; only the image and colour chunks are kept, wherever they sit (text after IDAT
 * included), and an XMP with the credit is added after IHDR.
 */

export class CleanError extends Error {}

/** The credit written back into the cleaned file, from the catalogue (catalog/iptc.ts). */
export interface Credit {
  creator: string | null
  copyright: string | null
}

export const CLEANABLE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png'])

/** Most of a JPEG's metadata sits before the image; more than this ahead of it isn't a photo we can vouch for. */
export const HEAD_CAP = 4 * 1024 * 1024

export interface Cleaned {
  body: ReadableStream<Uint8Array>
  /** Known when the end of the picture is known up front (FixedLengthStream); otherwise sent chunked. */
  length: number | null
}

/**
 * Clean `input` (the whole stored file, `size` bytes). For a JPEG, `endsWithEoi` says whether the stored file's last
 * two bytes are EOI, which with no multi-picture index means the picture runs to the end and the length is known.
 */
export async function cleanOriginal(input: ReadableStream<Uint8Array>, mimeType: string, size: number, credit: Credit, endsWithEoi = false): Promise<Cleaned> {
  const reader = new Buffered(input.getReader())
  try {
    if (mimeType === 'image/jpeg') return await cleanJpeg(reader, size, credit, endsWithEoi)
    if (mimeType === 'image/png') return await cleanPng(reader, credit)
  } catch (error) {
    await reader.cancel()
    throw error
  }
  await reader.cancel()
  throw new CleanError(`Can't clean ${mimeType}.`)
}

// ---- Reading ----

/** A stream reader that can hold bytes back: the head is gathered, then the rest passes through. */
class Buffered {
  private buf: Uint8Array = new Uint8Array(0)
  private done = false
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  /** Make at least `n` bytes available (fewer only at the end of the file). */
  async fill(n: number): Promise<Uint8Array> {
    while (this.buf.length < n && !this.done) {
      if (n > HEAD_CAP + 70_000) throw new CleanError('The file has too much before the picture.')
      const { value, done } = await this.reader.read()
      if (done) this.done = true
      else if (value.length) this.buf = concat([this.buf, value])
    }
    return this.buf
  }

  /** Drop the first `n` bytes held. */
  consume(n: number) {
    this.buf = this.buf.subarray(n)
  }

  /** What's held, then everything after it, chunk by chunk. */
  async *rest(): AsyncGenerator<Uint8Array> {
    if (this.buf.length) yield this.buf
    this.buf = new Uint8Array(0)
    while (!this.done) {
      const { value, done } = await this.reader.read()
      if (done) this.done = true
      else if (value.length) yield value
    }
  }

  async cancel() {
    if (!this.done) await this.reader.cancel().catch(() => {})
    this.done = true
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
const startsWith = (bytes: Uint8Array, at: number, text: string) => ascii(bytes, at, text.length) === text

/** A stream from an async generator, pulled as the client reads; `length` adds a FixedLengthStream. */
function streamOf(chunks: AsyncGenerator<Uint8Array>, length: number | null, cancel: () => Promise<void>): Cleaned {
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next()
        if (done) controller.close()
        else controller.enqueue(value)
      } catch (error) {
        // Fail closed: a cut-off download, never the rest of the file as stored.
        controller.error(error)
        await cancel()
      }
    },
    cancel: () => cancel(),
  })
  if (length === null || typeof FixedLengthStream !== 'function') return { body, length }
  return { body: body.pipeThrough(new FixedLengthStream(length)) as ReadableStream<Uint8Array>, length }
}

// ---- Credit (XMP) ----

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const creditText = (credit: Credit) => ({ creator: credit.creator?.trim().slice(0, 200), rights: credit.copyright?.trim().slice(0, 500) })

/** An XMP packet holding only the creator and copyright notice, or null with neither. */
export function creditXmp(credit: Credit): string | null {
  const { creator, rights } = creditText(credit)
  if (!creator && !rights) return null
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    (creator ? `<dc:creator><rdf:Seq><rdf:li>${xml(creator)}</rdf:li></rdf:Seq></dc:creator>` : '') +
    (rights ? `<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${xml(rights)}</rdf:li></rdf:Alt></dc:rights>` : '') +
    '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="r"?>'
  )
}

// ---- JPEG ----

const XMP_ID = 'http://ns.adobe.com/xap/1.0/\0'

/** APP1 XMP segment with the credit. */
function xmpSegment(packet: string): Uint8Array {
  const body = new TextEncoder().encode(XMP_ID + packet)
  const out = new Uint8Array(4 + body.length)
  out.set([0xff, 0xe1, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff])
  out.set(body, 4)
  return out
}

/** APP1 Exif segment holding only Artist and Copyright (UTF-8, as Lightroom writes them), or null with neither. */
function creditExifSegment(credit: Credit): Uint8Array | null {
  const { creator, rights } = creditText(credit)
  const values = (
    [
      [0x013b, creator], // Artist
      [0x8298, rights], // Copyright
    ] as const
  ).flatMap(([tag, text]) => (text ? [{ tag, bytes: new TextEncoder().encode(`${text}\0`) }] : []))
  if (!values.length) return null
  const ifdSize = 2 + values.length * 12 + 4
  const tiff = new Uint8Array(8 + ifdSize + values.reduce((n, v) => n + (v.bytes.length > 4 ? v.bytes.length : 0), 0))
  const view = new DataView(tiff.buffer)
  tiff.set([0x4d, 0x4d, 0x00, 0x2a]) // big-endian TIFF
  view.setUint32(4, 8)
  view.setUint16(8, values.length)
  let data = 8 + ifdSize
  values.forEach((v, i) => {
    const entry = 10 + i * 12
    view.setUint16(entry, v.tag)
    view.setUint16(entry + 2, 2) // ASCII
    view.setUint32(entry + 4, v.bytes.length)
    if (v.bytes.length <= 4) tiff.set(v.bytes, entry + 8)
    else {
      view.setUint32(entry + 8, data)
      tiff.set(v.bytes, data)
      data += v.bytes.length
    }
  })
  const body = concat([new TextEncoder().encode('Exif\0\0'), tiff])
  return concat([new Uint8Array([0xff, 0xe1, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff]), body])
}

/**
 * Write the credit into a JPEG cf-dam made itself (a Small or Large download), which Cloudflare Images outputs with
 * no metadata: Exif Artist and Copyright, which most viewers show, and the same XMP as a cleaned original. Placed after
 * SOI and a leading JFIF segment; a kind the file already has isn't added twice. Anything that isn't a JPEG is
 * returned as it is.
 */
export function creditJpeg(bytes: Uint8Array, credit: Credit): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  let insertAt = 2
  let hasExif = false
  let hasXmp = false
  // The leading APPn segments: where to insert, and what is already there.
  for (let at = 2; at + 4 <= bytes.length && bytes[at] === 0xff && bytes[at + 1]! >= 0xe0 && bytes[at + 1]! <= 0xef; ) {
    const end = at + 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!)
    if (end > bytes.length) return bytes
    if (bytes[at + 1] === 0xe0 && insertAt === at && startsWith(bytes, at + 4, 'JFIF\0')) insertAt = end
    if (bytes[at + 1] === 0xe1) {
      hasExif ||= startsWith(bytes, at + 4, 'Exif\0\0')
      hasXmp ||= startsWith(bytes, at + 4, XMP_ID)
    }
    at = end
  }
  const exif = hasExif ? null : creditExifSegment(credit)
  const packet = hasXmp ? null : creditXmp(credit)
  if (!exif && !packet) return bytes
  return concat([bytes.subarray(0, insertAt), ...(exif ? [exif] : []), ...(packet ? [xmpSegment(packet)] : []), bytes.subarray(insertAt)])
}

async function cleanJpeg(reader: Buffered, size: number, credit: Credit, endsWithEoi: boolean): Promise<Cleaned> {
  let head = await reader.fill(4)
  if (head[0] !== 0xff || head[1] !== 0xd8) throw new CleanError('Not a JPEG.')
  const kept: Uint8Array[] = [head.slice(0, 2)]
  let at = 2
  let primaryEnd: number | null = null
  let xmpAfter = 1 // insert the credit after SOI, or after APP0/Exif when they lead
  for (;;) {
    head = await reader.fill(at + 4)
    if (at + 4 > head.length) throw new CleanError('The file ends before the picture.')
    if (head[at] !== 0xff) throw new CleanError('Unexpected bytes between JPEG markers.')
    const marker = head[at + 1]!
    if (marker === 0xff) {
      at += 1 // fill byte
      continue
    }
    if (marker === 0xda) break // SOS: the picture starts
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) throw new CleanError('Unexpected JPEG marker before the picture.')
    const length = (head[at + 2]! << 8) | head[at + 3]!
    if (length < 2) throw new CleanError('Bad JPEG segment length.')
    head = await reader.fill(at + 2 + length)
    if (at + 2 + length > head.length) throw new CleanError('The file ends inside a JPEG segment.')
    const segment = head.slice(at, at + 2 + length)
    const leading = kept.length === xmpAfter
    if (marker === 0xe0) {
      if (startsWith(segment, 4, 'JFIF\0')) {
        kept.push(segment)
        if (leading) xmpAfter = kept.length
      }
    } else if (marker === 0xe1) {
      if (startsWith(segment, 4, 'Exif\0\0')) {
        cleanExif(segment)
        kept.push(segment)
        if (leading) xmpAfter = kept.length
      }
      // XMP, extended XMP and anything else in APP1: dropped.
    } else if (marker === 0xe2) {
      if (startsWith(segment, 4, 'ICC_PROFILE\0')) kept.push(segment)
      else if (startsWith(segment, 4, 'MPF\0') && primaryEnd === null) primaryEnd = mpfPrimarySize(segment)
    } else if (marker === 0xee) {
      if (startsWith(segment, 4, 'Adobe')) kept.push(segment)
    } else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) {
      // APP3–APP15 (C2PA in APP11, IPTC in APP13, and others) and comments: dropped.
    } else {
      kept.push(segment) // DQT, DHT, SOFn, DRI and the other coding markers
    }
    at += 2 + length
    if (at > HEAD_CAP) throw new CleanError('The file has too much before the picture.')
  }
  const packet = creditXmp(credit)
  if (packet) kept.splice(xmpAfter, 0, xmpSegment(packet))
  const out = concat(kept)
  reader.consume(at)

  // Where the first picture ends: from the multi-picture index, or the file's end when it ends with EOI.
  const end = primaryEnd ?? (endsWithEoi ? size : null)
  if (end !== null && end <= at) throw new CleanError('The multi-picture index is wrong.')
  const length = end === null ? null : out.length + (end - at)
  return streamOf(jpegBody(out, reader, end === null ? null : end - at), length, () => reader.cancel())
}

/** The cleaned head, then the picture up to and including its EOI, and nothing after. */
async function* jpegBody(head: Uint8Array, reader: Buffered, expected: number | null): AsyncGenerator<Uint8Array> {
  yield head
  const scan = new ScanReader()
  let sent = 0
  for await (const chunk of reader.rest()) {
    const stop = scan.feed(chunk)
    const part = stop === -1 ? chunk : chunk.subarray(0, stop)
    sent += part.length
    if (expected !== null && sent > expected) throw new CleanError('The picture runs past where its index says it ends.')
    if (part.length) yield part
    if (stop !== -1) break
  }
  await reader.cancel()
  if (!scan.ended) throw new CleanError('The picture has no end.')
  if (expected !== null && sent !== expected) throw new CleanError('The picture ends before where its index says.')
}

/**
 * Follows the coded picture from SOS to EOI across chunks. In entropy-coded data a 0xFF byte is followed by 0x00
 * (stuffing), a restart marker or more 0xFF; any other marker starts a segment with a length (another scan, tables)
 * or is EOI. Metadata between scans (APPn, COM) is refused: it can't be removed once the length is promised.
 */
class ScanReader {
  ended = false
  private state: 'data' | 'ff' | 'len1' | 'len2' | 'skip' = 'data'
  private marker = 0
  private remaining = 0

  /** Feed the next chunk; returns the index just after EOI in it, or -1. */
  feed(chunk: Uint8Array): number {
    let i = 0
    while (i < chunk.length) {
      switch (this.state) {
        case 'data': {
          const ff = chunk.indexOf(0xff, i)
          if (ff === -1) return -1
          i = ff + 1
          this.state = 'ff'
          break
        }
        case 'ff': {
          const b = chunk[i++]!
          if (b === 0xff) break // fill
          if (b === 0x00 || (b >= 0xd0 && b <= 0xd7)) {
            this.state = 'data'
          } else if (b === 0xd9) {
            this.ended = true
            return i
          } else if (b === 0xd8 || b === 0x01) {
            throw new CleanError('Unexpected JPEG marker inside the picture.')
          } else if ((b >= 0xe0 && b <= 0xef) || b === 0xfe) {
            throw new CleanError('Metadata between the scans of a JPEG.')
          } else {
            this.marker = b
            this.state = 'len1'
          }
          break
        }
        case 'len1':
          this.remaining = chunk[i++]! << 8
          this.state = 'len2'
          break
        case 'len2':
          this.remaining = (this.remaining | chunk[i++]!) - 2
          if (this.remaining < 0) throw new CleanError(`Bad length for JPEG marker ${this.marker.toString(16)}.`)
          this.state = this.remaining ? 'skip' : 'data'
          break
        case 'skip': {
          const n = Math.min(this.remaining, chunk.length - i)
          i += n
          this.remaining -= n
          if (!this.remaining) this.state = 'data'
          break
        }
      }
    }
    return -1
  }
}

// ---- TIFF structures (Exif, MPF) ----

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 }

/** IFD0 tags removed: descriptions, Windows XP fields, embedded XMP/IPTC/Photoshop blocks, ratings, GPS. */
const DROP_IFD0 = new Set([0x010e, 0x9c9b, 0x9c9c, 0x9c9d, 0x9c9e, 0x9c9f, 0x02bc, 0x83bb, 0x8649, 0x4746, 0x4749, 0x927c, 0x8825])
/** Exif IFD tags removed: the maker note (some hold face-recognition names), user comment, camera owner. */
const DROP_EXIF = new Set([0x927c, 0x9286, 0xa430, 0x9c9b, 0x9c9c, 0x9c9d, 0x9c9e, 0x9c9f, 0x02bc, 0x83bb, 0x8649])
const EXIF_IFD = 0x8769
const GPS_IFD = 0x8825

class Tiff {
  readonly le: boolean
  constructor(readonly bytes: Uint8Array) {
    if (bytes.length < 8) throw new CleanError('Short TIFF header.')
    const order = ascii(bytes, 0, 2)
    if (order !== 'II' && order !== 'MM') throw new CleanError('Bad TIFF byte order.')
    this.le = order === 'II'
  }
  check(at: number, n: number) {
    if (at < 0 || at + n > this.bytes.length) throw new CleanError('TIFF offset out of range.')
  }
  u16(at: number) {
    this.check(at, 2)
    const b = this.bytes
    return this.le ? b[at]! | (b[at + 1]! << 8) : (b[at]! << 8) | b[at + 1]!
  }
  u32(at: number) {
    this.check(at, 4)
    const b = this.bytes
    return (this.le ? b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24) : (b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0
  }
  put16(at: number, v: number) {
    this.check(at, 2)
    this.bytes.set(this.le ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff], at)
  }
  zero(at: number, n: number) {
    this.check(at, n)
    this.bytes.fill(0, at, at + n)
  }
  /** Zero what of [at, at + n) lies in this block: data pointed to outside it isn't in the file's head to leak. */
  zeroInside(at: number, n: number) {
    const start = Math.max(0, at)
    const end = Math.min(this.bytes.length, at + n)
    if (end > start) this.bytes.fill(0, start, end)
  }
  /** An IFD's entries: tag, the entry's offset, and where its value lives and how long it is. */
  entries(ifd: number) {
    const count = this.u16(ifd)
    this.check(ifd + 2, count * 12 + 4)
    const list: { tag: number; at: number; valueAt: number; valueLength: number }[] = []
    for (let k = 0; k < count; k++) {
      const at = ifd + 2 + k * 12
      const type = this.u16(at + 2)
      const length = (TYPE_SIZE[type] ?? 1) * this.u32(at + 4)
      list.push({ tag: this.u16(at), at, valueAt: length > 4 ? this.u32(at + 8) : at + 8, valueLength: length })
    }
    return list
  }
}

/** Remove `drop` tags from an IFD in place: their data zeroed, the remaining entries moved up, the freed tail zeroed. */
function dropTags(tiff: Tiff, ifd: number, drop: ReadonlySet<number>, onDrop?: (tag: number, valueAt: number) => void) {
  const entries = tiff.entries(ifd)
  const keep = entries.filter((e) => !drop.has(e.tag))
  if (keep.length === entries.length) return
  for (const e of entries) {
    if (keep.includes(e)) continue
    onDrop?.(e.tag, e.valueAt)
    if (e.valueLength > 4) tiff.zeroInside(e.valueAt, e.valueLength)
  }
  const next = tiff.bytes.slice(ifd + 2 + entries.length * 12, ifd + 6 + entries.length * 12)
  const rows = keep.map((e) => tiff.bytes.slice(e.at, e.at + 12))
  tiff.zero(ifd, 2 + entries.length * 12 + 4)
  tiff.put16(ifd, keep.length)
  rows.forEach((row, k) => tiff.bytes.set(row, ifd + 2 + k * 12))
  tiff.bytes.set(next, ifd + 2 + keep.length * 12)
}

/** Zero a whole IFD and the data its entries point to (the GPS IFD). */
function zeroIfd(tiff: Tiff, ifd: number) {
  if (ifd < 8 || ifd + 2 > tiff.bytes.length) return // points outside: nothing here to remove
  const entries = tiff.entries(ifd)
  for (const e of entries) if (e.valueLength > 4) tiff.zeroInside(e.valueAt, e.valueLength)
  tiff.zero(ifd, 2 + entries.length * 12 + 4)
}

/** Clean an APP1 Exif segment (marker, length, "Exif\0\0", TIFF) in place. Exported for tests. */
export function cleanExif(segment: Uint8Array) {
  const tiff = new Tiff(segment.subarray(10))
  const ifd0 = tiff.u32(4)
  const seen = new Set<number>()
  const subIfd = (at: number) => {
    if (seen.has(at)) throw new CleanError('An Exif IFD points back to itself.')
    seen.add(at)
    return at
  }
  const gps = (tag: number, valueAt: number) => {
    if (tag === GPS_IFD) zeroIfd(tiff, subIfd(tiff.u32(valueAt)))
  }
  const entries = tiff.entries(subIfd(ifd0))
  const exif = entries.find((e) => e.tag === EXIF_IFD)
  const exifAt = exif ? tiff.u32(exif.at + 8) : null
  const ifd1 = tiff.u32(ifd0 + 2 + entries.length * 12)
  dropTags(tiff, ifd0, DROP_IFD0, gps)
  if (exifAt !== null) dropTags(tiff, subIfd(exifAt), DROP_EXIF)
  // IFD1 describes the embedded thumbnail; the same tags go if a writer put them there.
  if (ifd1) dropTags(tiff, subIfd(ifd1), DROP_IFD0, gps)
}

/** The first picture's size from an APP2 MPF segment (marker, length, "MPF\0", TIFF): MP Entry 1's size. */
function mpfPrimarySize(segment: Uint8Array): number {
  const tiff = new Tiff(segment.subarray(8))
  const entry = tiff.entries(tiff.u32(4)).find((e) => e.tag === 0xb002)
  if (!entry || entry.valueLength < 16) throw new CleanError('A multi-picture index without entries.')
  return tiff.u32(entry.valueAt + 4)
}

// ---- PNG ----

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** The image, colour and animation chunks. Text, eXIf, tIME, C2PA (caBX) and everything else are dropped. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'cICP', 'sBIT', 'pHYs', 'bKGD', 'acTL', 'fcTL', 'fdAT'])

let crcTable: Uint32Array | null = null
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

async function cleanPng(reader: Buffered, credit: Credit): Promise<Cleaned> {
  const head = await reader.fill(8)
  if (PNG_SIGNATURE.some((b, i) => head[i] !== b)) throw new CleanError('Not a PNG.')
  const packet = creditXmp(credit)
  const xmpChunk = packet ? pngChunk('iTXt', new TextEncoder().encode(`XML:com.adobe.xmp\0\0\0\0\0${packet}`)) : null
  return streamOf(pngBody(reader, xmpChunk), null, () => reader.cancel())
}

/** The signature, then the kept chunks in order (the credit after IHDR), ending at IEND. */
async function* pngBody(reader: Buffered, xmpChunk: Uint8Array | null): AsyncGenerator<Uint8Array> {
  yield (await reader.fill(8)).slice(0, 8)
  reader.consume(8)
  let first = true
  for (;;) {
    const header = await reader.fill(8)
    if (header.length < 8) throw new CleanError('The PNG ends without IEND.')
    const length = new DataView(header.buffer, header.byteOffset, 8).getUint32(0)
    const type = ascii(header, 4, 4)
    if (!/^[A-Za-z]{4}$/.test(type) || length > 0x7fffffff) throw new CleanError('Bad PNG chunk.')
    if (first && type !== 'IHDR') throw new CleanError('The PNG doesn’t start with IHDR.')
    const keep = PNG_KEEP.has(type)
    // A critical chunk (upper-case first letter) we don't know can't be dropped safely.
    if (!keep && type[0]! === type[0]!.toUpperCase()) throw new CleanError(`Unknown critical PNG chunk ${type}.`)
    let remaining = 12 + length
    // Small chunks are held whole; IDAT and other big ones stream.
    while (remaining > 0) {
      const held = await reader.fill(Math.min(remaining, 65_536))
      if (!held.length) throw new CleanError('The PNG ends inside a chunk.')
      const n = Math.min(remaining, held.length)
      if (keep) yield held.slice(0, n)
      reader.consume(n)
      remaining -= n
    }
    if (first && xmpChunk) yield xmpChunk
    first = false
    if (type === 'IEND') break
  }
  await reader.cancel()
}

// ---- WebP (renditions) ----

/**
 * A WebP without its EXIF and XMP chunks (renditions are made without them; this makes sure). Returns the bytes
 * unchanged when there's nothing to remove.
 */
export function webpWithoutMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return bytes
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const kept: Uint8Array[] = []
  let dropped = false
  for (let at = 12; at + 8 <= bytes.length; ) {
    const type = ascii(bytes, at, 4)
    const size = view.getUint32(at + 4, true)
    const end = Math.min(bytes.length, at + 8 + size + (size & 1))
    if (type === 'EXIF' || type === 'XMP ') dropped = true
    else kept.push(bytes.slice(at, end))
    at = end
  }
  if (!dropped) return bytes
  const vp8x = kept.find((c) => ascii(c, 0, 4) === 'VP8X')
  if (vp8x && vp8x.length > 8) vp8x[8] = vp8x[8]! & ~0x0c // clear the EXIF and XMP flags
  const body = concat(kept)
  const out = new Uint8Array(12 + body.length)
  out.set(bytes.subarray(0, 12))
  new DataView(out.buffer).setUint32(4, 4 + body.length, true)
  out.set(body, 12)
  return out
}
