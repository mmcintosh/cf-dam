import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { decodePng, hashPixels } from '../../api/src/catalog/phash.ts'
import { Extractor } from '../src/extract.ts'
import { render } from '../src/render.ts'

const fixture = (name: string) => new URL(`../../api/test/fixtures/${name}`, import.meta.url).pathname
const extractor = new Extractor()
afterAll(() => extractor.end())

describe('reading photos with ExifTool', () => {
  it('maps camera, place, IPTC, Lightroom keyword paths and label like the Worker does', async () => {
    const { meta, source } = await extractor.extract(fixture('iptc.jpg'))
    expect(meta).toMatchObject({
      width: 1200,
      height: 800,
      capturedAt: '2024-06-15T18:42:07',
      cameraMake: 'Canon',
      cameraModel: 'Canon EOS R5',
      lens: 'RF85mm F1.2 L USM',
      focalLength: 85,
      aperture: 2.8,
      iso: 400,
      title: 'Storm over Bergen',
      label: 'Red',
    })
    expect(meta.gpsLat).toBeCloseTo(62.4667, 3)
    expect(meta.keywords).toEqual(['Places|Norway|Bergen'])
    expect(meta.iptc).toMatchObject({
      creator: 'Mark Photographer', credit: 'Mark Photo AS', usageTerms: 'Editorial use only', contactEmail: 'mark@example.com',
      city: 'Bergen', sublocation: 'Bryggen', state: 'Vestland', countryCode: 'NO', jobId: 'JOB-2041',
    })
    expect(source?.length).toBeGreaterThan(1000)
  })
})

describe('rendering', () => {
  it('makes an upright 2048/480 WebP pair and the same look-alike hash the Worker computes from that thumb', async () => {
    // A portrait photo stored sideways (Orientation 6), as cameras do.
    const sideways = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#335577' } })
      .composite([{ input: Buffer.from('<svg width="3000" height="2000"><rect width="900" height="2000" fill="#ddd"/></svg>') }])
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const r = await render(sideways)
    expect([r.width, r.height]).toEqual([1365, 2048])
    const thumb = await sharp(r.thumb).metadata()
    expect([thumb.format, thumb.width, thumb.height]).toEqual(['webp', 320, 480])
    // The Worker's path: the thumb as PNG (Images does this), decoded by our own PNG reader, same reducer.
    const worker = hashPixels(await decodePng(new Uint8Array(await sharp(r.thumb).png().toBuffer())))
    expect(r.phash).toBe(worker)
  })
})
