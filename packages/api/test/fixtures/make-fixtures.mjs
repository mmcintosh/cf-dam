// Regenerate the test images: node test/fixtures/make-fixtures.mjs (needs sharp, which wrangler brings).
import sharp from 'sharp'

const base = sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 40, g: 90, b: 160 } } })
  .composite([{ input: Buffer.from('<svg width="1200" height="800"><circle cx="600" cy="400" r="260" fill="#f4b942"/></svg>') }])

await base
  .clone()
  .jpeg({ quality: 85 })
  .withExif({
    IFD0: { Make: 'Canon', Model: 'Canon EOS R5', Artist: 'Test Photographer', Copyright: '(c) Test' },
    IFD2: {
      DateTimeOriginal: '2024:06:15 18:42:07',
      ExposureTime: '1/250',
      FNumber: '28/10',
      ISOSpeedRatings: '400',
      FocalLength: '85/1',
      LensModel: 'RF85mm F1.2 L USM',
    },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '62/1 28/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '6/1 9/1 0/1' },
  })
  .toFile(new URL('./camera.jpg', import.meta.url).pathname)

await base.clone().png().toFile(new URL('./gradient.png', import.meta.url).pathname)
console.log('fixtures written')
