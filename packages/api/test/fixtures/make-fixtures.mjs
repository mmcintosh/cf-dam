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

// iptc.jpg is camera.jpg plus IPTC/XMP fields, written with ExifTool (not sharp):
//   cp camera.jpg iptc.jpg && exiftool -overwrite_original \
//     -IPTC:By-line="Mark Photographer" -IPTC:By-lineTitle="Owner" -IPTC:Credit="Mark Photo AS" \
//     -IPTC:Source="Studio archive" -IPTC:CopyrightNotice="© 2024 Mark Photo AS" -IPTC:Headline="Storm over Bergen" \
//     -IPTC:City="Bergen" -IPTC:Sub-location="Bryggen" -IPTC:Province-State="Vestland" \
//     -IPTC:Country-PrimaryLocationName="Norway" -IPTC:Country-PrimaryLocationCode="NOR" \
//     -IPTC:OriginalTransmissionReference="JOB-2041" -IPTC:SpecialInstructions="No crop" \
//     -XMP-xmpRights:UsageTerms="Editorial use only" -XMP-xmpRights:WebStatement="https://example.com/licence" \
//     -XMP-iptcCore:CreatorWorkEmail="mark@example.com" -XMP-iptcCore:CreatorWorkTelephone="+47 555 0100" \
//     -XMP-iptcCore:CreatorWorkURL="https://example.com" -XMP-iptcCore:CountryCode="NO" \
//     -XMP-lr:HierarchicalSubject="Places|Norway|Bergen" -XMP-dc:Subject="Bergen" -XMP-xmp:Label="Red" iptc.jpg

// private.jpg and private.png carry names, captions, keywords, comments, a camera owner and GPS, for the cleaning
// tests (test/clean.test.ts), written with ExifTool:
//   cp camera.jpg private.jpg && exiftool -overwrite_original \
//     -XMP-iptcExt:PersonInImage="Lily Smith" -XMP-iptcExt:PersonInImage="Grandma Jo" \
//     '-XMP-mwg-rs:RegionInfo={AppliedToDimensions={W=1200,H=800,Unit=pixel},RegionList=[{Area={X=0.5,Y=0.5,W=0.1,H=0.1,Unit=normalized},Name=Lily Smith,Type=Face}]}' \
//     -XMP-dc:Description="Lily, 4, with Grandma Jo" -XMP-dc:Subject="smith family" -XMP-dc:Creator="Test Photographer" \
//     -XMP-dc:Rights="© 2024 Test Studio" -IPTC:Caption-Abstract="Lily, 4, with Grandma Jo" -IPTC:Keywords="smith family" \
//     -IPTC:CopyrightNotice="© 2024 Test Studio" -IPTC:By-line="Test Photographer" -EXIF:ImageDescription="Lily at the lake" \
//     -EXIF:XPComment="Lily secret" -EXIF:UserComment="Lily usercomment" -ExifIFD:OwnerName="Jo Owner" \
//     -Comment="Lily jpeg comment" private.jpg
//   cp gradient.png private.png && exiftool -overwrite_original \
//     -XMP-iptcExt:PersonInImage="Lily Smith" -XMP-dc:Description="Lily, 4, with Grandma Jo" -XMP-dc:Rights="© 2024 Test Studio" \
//     -PNG:Comment="Lily png comment" -EXIF:GPSLatitude=62.4667 -EXIF:GPSLatitudeRef=N -EXIF:GPSLongitude=6.15 \
//     -EXIF:GPSLongitudeRef=E -EXIF:ImageDescription="Lily at the lake" private.png
