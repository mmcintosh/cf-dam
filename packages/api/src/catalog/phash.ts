/**
 * Look-alike detection: a 64-bit perceptual difference hash (dHash) per photo.
 *
 * Images renders the photo's thumbnail as a 9×8 RGB PNG; we decode it here (Workers have no image
 * decoder, but PNG is just zlib-compressed scanlines and DecompressionStream does zlib), convert to
 * grey, and set each of 64 bits by whether a pixel is clearly brighter than its right-hand neighbour. Resized,
 * recompressed and lightly edited copies land within a few bits of each other.
 *
 * Finding neighbours without comparing every pair: each hash is split into BANDS bands. Two hashes
 * within MAX_DISTANCE bits must agree exactly on at least one band (pigeonhole: 5 differing bits can
 * touch at most 5 of 6 bands), so a new photo is checked only against photos sharing a band.
 */
import type { DamBindings } from '../env'
import { nowIso } from '../lib/time'
import { renditionStore } from '../storage/connections'
import { renditionKey } from './renditions'

export const MAX_DISTANCE = 5
/**
 * Two neighbouring pixels must differ by more than this (grey levels, 0–255) for their bit to be 1.
 * Without it, flat areas such as sky set bits from compression noise. Measured on 80 different
 * textured scenes × 5 copies (resized, quality 40, +15% brightness, small WebP, black and white):
 * recall 87% → 96%, with 0 false matches among 3,160 pairs of different scenes, at MAX_DISTANCE 5.
 */
export const DEAD_ZONE = 4
/**
 * Resized and re-saved copies keep their shape, but the 9×8 squeeze throws shape away, so a
 * panorama could match a 3:2 frame of similar tones. Pairs must also be within this aspect-ratio gap.
 */
export const MAX_ASPECT_DIFFERENCE = 0.08
const BAND_BITS = [11, 11, 11, 11, 10, 10] as const

// ── PNG (8-bit, non-interlaced: what Images emits) ────────────────────────────

interface Decoded {
  width: number
  height: number
  channels: number
  pixels: Uint8Array
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export async function decodePng(bytes: Uint8Array): Promise<Decoded> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0) !== 0x89504e47) throw new Error('Not a PNG.')
  let offset = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  const idat: Uint8Array[] = []
  while (offset < bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8)
      height = view.getUint32(offset + 12)
      depth = data[8]!
      colorType = data[9]!
      if (data[12] !== 0) throw new Error('Interlaced PNGs are not supported.')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (depth !== 8 || !channels) throw new Error(`Unsupported PNG (depth ${depth}, colour type ${colorType}).`)

  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const chunk of idat) {
    joined.set(chunk, at)
    at += chunk.length
  }
  const raw = await inflate(joined)
  const stride = width * channels
  const pixels = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels]! : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels]! : 0
      const value = line[x]!
      const predicted = filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0
      pixels[y * stride + x] = (value + predicted) & 0xff
    }
  }
  return { width, height, channels, pixels }
}

// ── The hash ──────────────────────────────────────────────────────────────────

/** dHash of a 9×8 image: 16 hex characters. */
export function dhash(image: Decoded): string {
  if (image.width !== 9 || image.height !== 8) throw new Error('dHash needs a 9×8 image.')
  const grey = (x: number, y: number) => {
    const i = (y * 9 + x) * image.channels
    if (image.channels < 3) return image.pixels[i]!
    return 0.299 * image.pixels[i]! + 0.587 * image.pixels[i + 1]! + 0.114 * image.pixels[i + 2]!
  }
  let bits = 0n
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits = (bits << 1n) | (grey(x, y) - grey(x + 1, y) > DEAD_ZONE ? 1n : 0n)
  }
  return bits.toString(16).padStart(16, '0')
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  let count = 0
  while (x) {
    x &= x - 1n
    count++
  }
  return count
}

export function bands(hash: string): number[] {
  let bits = BigInt(`0x${hash}`)
  const out: number[] = []
  for (const width of [...BAND_BITS].reverse()) {
    out.unshift(Number(bits & ((1n << BigInt(width)) - 1n)))
    bits >>= BigInt(width)
  }
  return out
}

/** The look-alike hash of an asset, from its stored thumbnail. Null when it has none or Images is absent. */
export async function hashFromThumbnail(env: DamBindings, assetId: string): Promise<string | null> {
  if (!env.IMAGES) return null
  const thumb = await renditionStore(env).get(renditionKey(assetId, 'thumb'))
  if (!thumb) return null
  const tiny = await env.IMAGES.input(thumb.body)
    .transform({ width: 9, height: 8, fit: 'squeeze' })
    .output({ format: 'image/png' })
  return dhash(await decodePng(new Uint8Array(await tiny.response().arrayBuffer())))
}

/** Store an asset's hash and record every look-alike within MAX_DISTANCE. Returns how many it found. */
export async function recordHash(db: D1Database, assetId: string, hash: string): Promise<number> {
  const parts = bands(hash)
  await db.batch([
    db.prepare('UPDATE assets SET phash = ? WHERE id = ?').bind(hash, assetId),
    db.prepare('DELETE FROM asset_hash_bands WHERE asset_id = ?').bind(assetId),
    ...parts.map((value, band) => db.prepare('INSERT INTO asset_hash_bands (asset_id, band, value) VALUES (?, ?, ?)').bind(assetId, band, value)),
  ])
  const self = await db.prepare('SELECT width, height FROM assets WHERE id = ?').bind(assetId).first<{ width: number | null; height: number | null }>()
  const ratio = self?.width && self.height ? self.width / self.height : null
  const { results } = await db
    .prepare(
      `SELECT DISTINCT a.id, a.phash, a.width, a.height FROM asset_hash_bands hb
       JOIN assets a ON a.id = hb.asset_id
       WHERE (${parts.map(() => '(hb.band = ? AND hb.value = ?)').join(' OR ')})
         AND hb.asset_id != ? AND a.deleted_at IS NULL AND a.phash IS NOT NULL
       LIMIT 2000`,
    )
    .bind(...parts.flatMap((value, band) => [band, value]), assetId)
    .all<{ id: string; phash: string; width: number | null; height: number | null }>()
  const sameShape = (r: { width: number | null; height: number | null }) => {
    if (!ratio || !r.width || !r.height) return true
    const other = r.width / r.height
    return Math.abs(ratio - other) / Math.max(ratio, other) <= MAX_ASPECT_DIFFERENCE
  }
  const near = results
    .filter(sameShape)
    .map((r) => ({ id: r.id, distance: hamming(hash, r.phash) }))
    .filter((r) => r.distance <= MAX_DISTANCE)
  if (near.length > 0) {
    const now = nowIso()
    await db.batch(
      near.map((r) => {
        const [a, b] = assetId < r.id ? [assetId, r.id] : [r.id, assetId]
        return db.prepare('INSERT OR IGNORE INTO similar_pairs (a, b, distance, created_at) VALUES (?, ?, ?, ?)').bind(a, b, r.distance, now)
      }),
    )
  }
  return near.length
}
