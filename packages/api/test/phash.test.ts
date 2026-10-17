import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { areaGrey, decodePng, hashPixels } from '../src/catalog/phash'

/** A 37×23 test card: a gradient, a few hard edges, odd sizes so averaging cells split pixels. */
async function card(): Promise<Buffer> {
  const w = 37
  const h = 23
  const raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      raw[i] = (x * 7) % 256
      raw[i + 1] = x > 18 ? 220 : 30
      raw[i + 2] = (y * 11) % 256
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
}

async function reference(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, channels: info.channels, pixels: new Uint8Array(data) }
}

describe('decodePng', () => {
  it('decodes truecolour, grey and palette PNGs (including 1-, 2- and 4-bit palettes) like a reference decoder', async () => {
    const base = await card()
    const variants: [string, Buffer][] = [
      ['rgb', base],
      ['grey', await sharp(base).greyscale().png().toBuffer()],
      ['palette 256', await sharp(base).png({ palette: true, colours: 256 }).toBuffer()],
      ['palette 16', await sharp(base).png({ palette: true, colours: 16 }).toBuffer()],
      ['palette 4', await sharp(base).png({ palette: true, colours: 4 }).toBuffer()],
      ['palette 2', await sharp(base).png({ palette: true, colours: 2 }).toBuffer()],
    ]
    for (const [name, png] of variants) {
      const ours = await decodePng(new Uint8Array(png))
      const theirs = await reference(png)
      expect([name, ours.width, ours.height]).toEqual([name, theirs.width, theirs.height])
      // Compare as grey so 1-channel and 3-channel decodes of the same image line up.
      const grey = (img: typeof ours) => areaGrey(img.pixels, img.width, img.height, img.channels, img.width, img.height).pixels
      expect([name, ...grey(ours)]).toEqual([name, ...grey(theirs)])
    }
  })
})

describe('areaGrey', () => {
  it('averages exactly by overlapped area', () => {
    // 2×1 → 1×1: the mean. 3×1 → 2×1: the middle pixel splits half and half.
    expect([...areaGrey(new Uint8Array([0, 100]), 2, 1, 1, 1, 1).pixels]).toEqual([50])
    expect([...areaGrey(new Uint8Array([0, 60, 120]), 3, 1, 1, 2, 1).pixels]).toEqual([20, 100])
  })

  it('gives the same hash for the same picture at different sizes and encodings', async () => {
    const big = await sharp(await card()).resize(480, 298).png().toBuffer()
    const small = await sharp(big).resize(240, 149).webp({ quality: 80 }).toBuffer()
    const a = hashPixels(await reference(big))
    const b = hashPixels(await reference(await sharp(small).png().toBuffer()))
    const distance = [...(BigInt(`0x${a}`) ^ BigInt(`0x${b}`)).toString(2)].filter((c) => c === '1').length
    expect(distance).toBeLessThanOrEqual(2)
  })
})
