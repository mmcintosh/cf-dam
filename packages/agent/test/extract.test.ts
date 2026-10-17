import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { decodePng, hashPixels } from '../../api/src/catalog/phash.ts'
import { Extractor, seconds, TOOLS } from '../src/extract.ts'
import { render, renderSheet } from '../src/render.ts'

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

/**
 * Video fixtures, made with the agent's video image:
 *   ffmpeg -f lavfi -i testsrc2=duration=6:size=480x270:rate=25 -c:v libx264 -pix_fmt yuv420p -crf 38 \
 *     -metadata creation_time=2023-07-14T16:20:00Z clip.mp4
 *   ffmpeg -f lavfi -i testsrc=duration=4:size=480x270:rate=30 -c:v libx264 -pix_fmt yuv420p -crf 34 \
 *     -metadata com.apple.quicktime.creationdate=2023-08-02T09:15:30+0200 -movflags use_metadata_tags phone.mov
 *   exiftool -Rotation=90 phone.mov
 */
const clip = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname

describe('videos', () => {
  it('reads length, codec, frame rate, a phone’s local time and offset, and rotation', async () => {
    const phone = (await extractor.extract(clip('phone.mov'))).meta
    expect(phone).toMatchObject({ capturedAt: '2023-08-02T09:15:30', capturedOffset: '+02:00', width: 480, height: 270, orientation: 6 })
    expect(phone.video).toEqual({ duration: 4, codec: 'h264', frameRate: 30 })
    const mp4 = (await extractor.extract(clip('clip.mp4'))).meta
    expect(mp4).toMatchObject({ capturedAt: '2023-07-14T16:20:00', capturedOffset: null, orientation: 1 })
    expect(mp4.video).toMatchObject({ duration: 6, codec: 'h264', frameRate: 25 })
    expect([seconds('0:01:23'), seconds('83.4 s'), seconds(12)]).toEqual([83, 83.4, 12])
  })

  it.skipIf(!TOOLS.ffmpeg)('makes an upright poster and a 2×2 contact sheet when ffmpeg is installed', async () => {
    const x = await extractor.extract(clip('phone.mov'))
    const poster = await render(x.source!, x.orientation)
    expect(poster.height).toBeGreaterThan(poster.width) // turned upright
    const sheet = await sharp(await renderSheet(x.frames!)).metadata()
    expect([sheet.format, sheet.width, sheet.height]).toEqual(['webp', 960, 540])
  })
})
