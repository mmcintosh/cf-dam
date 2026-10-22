/**
 * The look-alike hash itself, with no imports: shared by the Worker (catalog/phash.ts) and the NAS
 * agent, which must produce identical hashes for the same picture.
 *
 * Pixels → exact area average to 9×8 grey (`areaGrey`) → 64 bits, each set when a pixel is clearly
 * brighter than its right-hand neighbour (`dhash`). Neighbours are found through bands (`bands`):
 * hashes within MAX_DISTANCE bits must agree exactly on at least one band.
 */

export const MAX_DISTANCE = 5
/**
 * Two neighbouring pixels must differ by more than this (grey levels, 0–255) for their bit to be 1.
 * Without it, flat areas such as sky set bits from compression noise. Measured on 80 different
 * textured scenes × 5 copies (resized, quality 40, +15% brightness, small WebP, black and white):
 * recall 87% → 96%, with 0 false matches among 3,160 pairs of different scenes, at MAX_DISTANCE 5.
 */
export const DEAD_ZONE = 4
/**
 * Below this many set bits a hash says little about the picture (a black video frame, a blank page,
 * fog, a night sky): any two such hashes are within MAX_DISTANCE of each other, so they would all pair
 * with each other, and the pairs grow with the square of their number. They aren't paired. In a
 * 1,000-photo test library the median was 14 bits and 3% fell below 6.
 */
export const MIN_DETAIL_BITS = 6
/**
 * Resized and re-saved copies keep their shape, but averaging down to 9×8 throws shape away, so a
 * panorama could match a 3:2 frame of similar tones. Pairs must also be within this aspect-ratio gap.
 */
export const MAX_ASPECT_DIFFERENCE = 0.08
const BAND_BITS = [11, 11, 11, 11, 10, 10] as const

export interface Decoded {
  width: number
  height: number
  channels: number
  pixels: Uint8Array
}

/**
 * Exact area-average of an image down to W×H grey (BT.601 luma). Every source pixel contributes to
 * the output cells it overlaps, by the overlapping area, so there is no resampling kernel to differ
 * between runtimes. Shared with the NAS agent; keep it dependency-free.
 */
export function areaGrey(pixels: Uint8Array, w: number, h: number, channels: number, W = 9, H = 8): Decoded {
  const out = new Float64Array(W * H)
  const weight = new Float64Array(W * H)
  const sx = W / w
  const sy = H / h
  for (let y = 0; y < h; y++) {
    const y0 = y * sy
    const y1 = (y + 1) * sy
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels
      const g = channels < 3 ? pixels[i]! : 0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!
      const x0 = x * sx
      const x1 = (x + 1) * sx
      for (let oy = Math.floor(y0); oy < Math.min(H, Math.ceil(y1)); oy++) {
        const fy = Math.min(y1, oy + 1) - Math.max(y0, oy)
        for (let ox = Math.floor(x0); ox < Math.min(W, Math.ceil(x1)); ox++) {
          const f = fy * (Math.min(x1, ox + 1) - Math.max(x0, ox))
          if (f > 0) {
            out[oy * W + ox]! += g * f
            weight[oy * W + ox]! += f
          }
        }
      }
    }
  }
  return { width: W, height: H, channels: 1, pixels: Uint8Array.from(out, (v, i) => Math.round(v / weight[i]!)) }
}

/** The look-alike hash of decoded pixels (any size): area-average to 9×8 grey, then dHash. */
export const hashPixels = (image: Decoded): string => dhash(areaGrey(image.pixels, image.width, image.height, image.channels))

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

/** Set bits: how much a hash says (see MIN_DETAIL_BITS). */
export const bitsSet = (hash: string) => hamming(hash, '0'.repeat(hash.length))

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  let count = 0
  while (x) {
    x &= x - 1n
    count++
  }
  return count
}

/**
 * A plain hash (sky, fog: fewer than MIN_DETAIL_BITS set) is still paired, but only with a photo of
 * the very same hash and the very same pixel size: a re-saved copy of a plain photo keeps both, while
 * two different plain scenes rarely share all 64 bits and the size too. A blank hash (no bits: a
 * black frame, a lens cap) says nothing, and videos are left out, since their first frames are often
 * blank or plain.
 */
export const isPlain = (hash: string) => {
  const bits = bitsSet(hash)
  return bits > 0 && bits < MIN_DETAIL_BITS
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
