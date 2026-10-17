// Build public/places/cities1000.tsv.gz: every place with 1,000+ people (not city districts), for looking up a city,
// region and country from a photo's GPS. Data: GeoNames (https://www.geonames.org), CC BY 4.0.
//
//   node scripts/build-places.mjs            (downloads about 10 MB from download.geonames.org)
//
// Output lines (tab separated, gzip):
//   C <code> <country name>          one per country
//   A <code.admin1> <region name>    one per first-level region
//   <lat> <lng> <name> <code> <admin1> <population>   one per place, sorted by latitude
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const BASE = 'https://download.geonames.org/export/dump'
const dir = mkdtempSync(join(tmpdir(), 'geonames-'))
async function download(name) {
  const res = await fetch(`${BASE}/${name}`)
  if (!res.ok) throw new Error(`${name}: ${res.status}`)
  const path = join(dir, name)
  writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  return path
}

const zip = await download('cities1000.zip')
execFileSync('unzip', ['-o', '-q', zip, '-d', dir])
const admin1 = readFileSync(await download('admin1CodesASCII.txt'), 'utf8')
const countries = readFileSync(await download('countryInfo.txt'), 'utf8')

const out = []
for (const line of countries.split('\n')) {
  if (!line || line.startsWith('#')) continue
  const f = line.split('\t')
  out.push(['C', f[0], f[4]].join('\t'))
}
for (const line of admin1.split('\n')) {
  if (!line) continue
  const f = line.split('\t')
  out.push(['A', f[0], f[1]].join('\t'))
}
const places = []
for (const line of readFileSync(join(dir, 'cities1000.txt'), 'utf8').split('\n')) {
  if (!line) continue
  const f = line.split('\t')
  // Sections of a city ("Paris 16 Passy", feature code PPLX) would beat the city itself on distance.
  if (f[7] === 'PPLX') continue
  // name, lat, lng, country code, admin1 code, population. Coordinates to 4 decimals (~11 m) are plenty.
  places.push([Number(f[4]).toFixed(4), Number(f[5]).toFixed(4), f[1], f[8], f[10], f[14] || '0'])
}
places.sort((a, b) => Number(a[0]) - Number(b[0]))
for (const p of places) out.push(p.join('\t'))

const gz = gzipSync(out.join('\n'), { level: 9 })
writeFileSync(new URL('../public/places/cities1000.tsv.gz', import.meta.url), gz)
console.log(`${places.length} places, ${(gz.length / 1024 / 1024).toFixed(2)} MB`)
