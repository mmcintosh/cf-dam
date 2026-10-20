/**
 * A made-up catalog shaped like the first photographer's: RAW files indexed on a NAS by an agent and
 * archived to S3 Deep Archive (two locations each), keywords from a tree of a few thousand (places,
 * birds, events, clients, subjects), GPS on some, bursts of near-identical frames, albums.
 *
 * Rows go straight into SQLite (fast); the search index is then built by the app's own indexAssets,
 * which also times a full reindex.
 */
import { randomBytes } from 'node:crypto'
import { bands } from '../src/catalog/phash'
import { indexAssets } from '../src/catalog/search'
import { migrate } from '../src/db/migrate'
import { asD1, type D1Sqlite } from './d1-sqlite'

const hex = (bytes: number) => randomBytes(bytes).toString('hex')
/** Deterministic enough to compare runs, random enough to look real. */
let seed = 20261020
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)]!
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

const CAMERAS = [
  ['NIKON CORPORATION', 'NIKON Z 9', 'NEF', 'image/x-nikon-nef', 8256, 5504],
  ['NIKON CORPORATION', 'NIKON D500', 'NEF', 'image/x-nikon-nef', 5568, 3712],
  ['NIKON CORPORATION', 'NIKON D850', 'NEF', 'image/x-nikon-nef', 8256, 5504],
  ['NIKON CORPORATION', 'NIKON D4S', 'NEF', 'image/x-nikon-nef', 4928, 3280],
  ['Canon', 'Canon EOS 5D Mark III', 'CR2', 'image/x-canon-cr2', 5760, 3840],
  ['Canon', 'Canon EOS R5', 'CR3', 'image/x-canon-cr3', 8192, 5464],
  ['SONY', 'ILCE-7RM4', 'ARW', 'image/x-sony-arw', 9504, 6336],
  ['FUJIFILM', 'X-T4', 'RAF', 'image/x-fuji-raf', 6240, 4160],
  ['Apple', 'iPhone 13 Pro', 'HEIC', 'image/heic', 4032, 3024],
  ['NIKON CORPORATION', 'NIKON Z 9', 'JPG', 'image/jpeg', 8256, 5504],
] as const
const LENSES = ['NIKKOR Z 800mm f/6.3 VR S', 'NIKKOR Z 100-400mm f/4.5-5.6 VR S', 'AF-S NIKKOR 500mm f/5.6E PF ED VR', 'AF-S NIKKOR 200-500mm f/5.6E ED VR', 'NIKKOR Z 24-70mm f/2.8 S', 'EF70-200mm f/2.8L IS II USM', 'RF100-500mm F4.5-7.1 L IS USM', 'FE 200-600mm F5.6-6.3 G OSS', 'XF100-400mmF4.5-5.6 R LM OIS WR', 'iPhone 13 Pro back triple camera 5.7mm f/1.5']
const COUNTRIES = ['Norway', 'Sweden', 'Iceland', 'Scotland', 'Kenya', 'Tanzania', 'Costa Rica', 'Ecuador', 'Brazil', 'India', 'Japan', 'Australia', 'New Zealand', 'Canada', 'United States', 'Mexico', 'South Africa', 'Botswana', 'Spain', 'Portugal', 'France', 'Italy', 'Finland', 'Chile', 'Argentina', 'Peru', 'Colombia', 'Panama', 'Belize', 'Guatemala']
const FAMILIES = ['Herons', 'Owls', 'Eagles', 'Hawks', 'Falcons', 'Kingfishers', 'Hummingbirds', 'Warblers', 'Sparrows', 'Finches', 'Gulls', 'Terns', 'Ducks', 'Geese', 'Swans', 'Cranes', 'Rails', 'Plovers', 'Sandpipers', 'Woodpeckers', 'Parrots', 'Pigeons', 'Cuckoos', 'Swifts', 'Swallows', 'Thrushes', 'Wrens', 'Jays', 'Crows', 'Tits', 'Nuthatches', 'Shrikes', 'Vireos', 'Tanagers', 'Cardinals', 'Blackbirds', 'Pelicans', 'Cormorants', 'Ibises', 'Storks']
const SUBJECTS = ['flight', 'nest', 'feeding', 'courtship', 'portrait', 'sunrise', 'sunset', 'fog', 'snow', 'rain', 'water', 'reflection', 'silhouette', 'backlight', 'juvenile', 'pair', 'flock', 'perched', 'landing', 'takeoff', 'catch', 'preening', 'singing', 'display', 'habitat']

export interface GenerateOptions {
  photos: number
  /** Called every so often with what's done. */
  progress?: (message: string) => void
}

interface Tag {
  id: string
  path: string
}

function insertTags(db: D1Sqlite, now: string): { places: Tag[]; species: Tag[]; events: Tag[]; clients: Tag[]; subjects: Tag[] } {
  const add = db.sqlite.prepare(
    'INSERT INTO tags (id, name, name_key, parent_id, path, full_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const made = new Map<string, string>()
  const ensure = (names: string[]): Tag => {
    let parent: string | null = null
    for (let i = 0; i < names.length; i++) {
      const path = names.slice(0, i + 1).map((n) => n.toLowerCase()).join('|')
      let id = made.get(path)
      if (!id) {
        id = hex(16)
        add.run(id, names[i]!, names[i]!.toLowerCase(), parent, path, names.slice(0, i + 1).join('|'), now)
        made.set(path, id)
      }
      parent = id
    }
    return { id: parent!, path: names.map((n) => n.toLowerCase()).join('|') }
  }
  db.sqlite.exec('BEGIN')
  const places = COUNTRIES.flatMap((country) => Array.from({ length: 10 }, (_, i) => ensure(['Places', country, `${country} site ${i + 1}`])))
  const species = FAMILIES.flatMap((family) => Array.from({ length: 25 }, (_, i) => ensure(['Birds', family, `${family.slice(0, -1)} species ${i + 1}`])))
  const events = Array.from({ length: 200 }, (_, i) => ensure(['Events', `${2005 + (i % 21)}`, `Event ${i + 1}`]))
  const clients = Array.from({ length: 300 }, (_, i) => ensure(['Clients', `Client ${i + 1}`]))
  const subjects = SUBJECTS.map((s) => ensure(['Subjects', s]))
  db.sqlite.exec('COMMIT')
  return { places, species, events, clients, subjects }
}

/** Build the catalog. Returns how long each part took (ms). */
export async function generate(db: D1Sqlite, options: GenerateOptions): Promise<Record<string, number>> {
  const timings: Record<string, number> = {}
  const time = async (name: string, run: () => unknown) => {
    const started = performance.now()
    await run()
    timings[name] = Math.round(performance.now() - started)
  }
  const now = new Date().toISOString()
  const say = options.progress ?? (() => {})

  await time('migrate', () => migrate(asD1(db)))
  db.sqlite.exec(`
    INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES ('owner', 'Photographer', 'owner@example.com', 1, '${now}', '${now}');
    INSERT INTO storage_connections (id, name, provider, prefix, auth_mode, storage_classes, default_class, is_default, created_at, updated_at)
      VALUES ('nas', 'Studio NAS', 'nas', '', 'agent', '["NAS"]', 'NAS', 0, '${now}', '${now}'),
             ('glacier', 'Glacier archive', 's3', 'archive', 'oidc-role', '["DEEP_ARCHIVE"]', 'DEEP_ARCHIVE', 0, '${now}', '${now}');
  `)
  const tags = await (async () => {
    let made!: ReturnType<typeof insertTags>
    await time('tags', () => (made = insertTags(db, now)))
    return made
  })()

  const asset = db.sqlite.prepare(`INSERT INTO assets (id, owner_id, filename, title, caption, mime_type, size, sha256, width, height, orientation,
      captured_at, captured_offset, camera_make, camera_model, lens, focal_length, aperture, exposure_time, iso, gps_lat, gps_lng, rating,
      metadata, status, created_at, updated_at, flag, phash, label, creator, copyright, city, state, country, country_code, place_checked_at,
      search_id, place_gps)
    VALUES (?, 'owner', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, '+01:00', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, 'Simon Example',
      '© Simon Example', ?, ?, ?, ?, ?, ?, ?)`)
  const location = db.sqlite.prepare(`INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, size, etag, updated_at, mtime, quick_hash, seen_at, check_due_at)
    VALUES (?, ?, ?, ?, 'present', ?, ?, ?, ?, ?, ?, ?)`)
  const rendition = db.sqlite.prepare(`INSERT INTO renditions (asset_id, name, key, mime_type, width, height, size, source, created_at) VALUES (?, ?, ?, 'image/webp', ?, ?, ?, 'agent', ?)`)
  const tag = db.sqlite.prepare(`INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, source, created_at) VALUES (?, ?, 'import', ?)`)
  const band = db.sqlite.prepare(`INSERT INTO asset_hash_bands (asset_id, band, value) VALUES (?, ?, ?)`)

  const ids: string[] = []
  const start = Date.parse('2005-01-01T00:00:00Z')
  const span = Date.parse('2026-10-01T00:00:00Z') - start
  let burstHash = hex(8)
  let burstLeft = 0
  let shoot = { at: start, folder: '', place: tags.places[0]!, species: tags.species[0]!, client: tags.clients[0]!, gps: false }

  await time('photos', () => {
    db.sqlite.exec('BEGIN')
    for (let n = 0; n < options.photos; n++) {
      // Shoots of ~200 frames: same day, place, subject and folder.
      if (n % 200 === 0) {
        const at = start + Math.floor(rand() * span)
        const date = new Date(at).toISOString().slice(0, 10)
        shoot = { at, folder: `photo/${date.slice(0, 4)}/${date} ${pick(COUNTRIES)} ${n / 200 + 1}`, place: pick(tags.places), species: pick(tags.species), client: pick(tags.clients), gps: rand() < 0.1 }
      }
      const id = hex(16)
      ids.push(id)
      const [make, model, ext, mime, w, h] = pick(CAMERAS)
      const capturedAt = new Date(shoot.at + n * 1300).toISOString()
      const filename = `DSC_${String(n % 10000).padStart(4, '0')}.${ext}`
      const size = ext === 'JPG' || ext === 'HEIC' ? between(4, 18) * 1e6 : between(25, 70) * 1e6
      const sha = hex(32)
      // Bursts of near-identical frames: a few bits apart.
      if (burstLeft-- <= 0) {
        burstHash = hex(8)
        burstLeft = rand() < 0.2 ? between(3, 8) : 0
      }
      const phash = burstLeft > 0 ? flipBits(burstHash, between(1, 4)) : hex(8)
      // Real catalogs keep little here (22 bytes a photo on average in the birds test set): most none, a few a lot.
      const metadata = rand() < 0.97 ? null : JSON.stringify({
        exif: { Make: make, Model: model, LensModel: pick(LENSES), ExposureProgram: 'Manual', MeteringMode: 'Matrix', Flash: 'Off', WhiteBalance: 'Auto', ColorSpace: 'sRGB', Software: 'Ver.4.10', ImageWidth: w, ImageHeight: h, SubjectDistance: rand() * 30 },
        xmp: { Rating: between(0, 5), CreatorTool: 'Adobe Photoshop Lightroom Classic 13.2', DocumentID: `xmp.did:${hex(16)}`, InstanceID: `xmp.iid:${hex(16)}`, History: 'saved; converted; derived' },
      })
      const country = shoot.place.path.split('|')[1]!
      asset.run(
        id, filename, rand() < 0.1 ? `${pick(SUBJECTS)} at ${country}` : null, rand() < 0.05 ? `A ${pick(SUBJECTS)} photographed during a long morning in ${country}.` : null,
        mime, size, sha, w, h, capturedAt, make, model, pick(LENSES), between(24, 800), pick([2.8, 4, 5.6, 6.3, 8, 11]), pick([1 / 4000, 1 / 2000, 1 / 1000, 1 / 250, 1 / 60]), pick([100, 400, 800, 1600, 3200, 6400, 12800]),
        shoot.gps ? 40 + rand() * 20 : null, shoot.gps ? -10 + rand() * 40 : null, rand() < 0.2 ? between(1, 5) : null,
        metadata, now, now, rand() < 0.05 ? pick(['pick', 'reject']) : null, phash, rand() < 0.05 ? pick(['red', 'yellow', 'green', 'blue', 'purple']) : null,
        shoot.gps ? `${country} town` : null, shoot.gps ? 'Region' : null, country, shoot.gps ? 'XX' : null, shoot.gps ? now : null,
        n + 1, shoot.gps ? 7 : 0,
      )
      const due = new Date(Date.now() + rand() * 30 * 86_400_000).toISOString()
      location.run(id, 'nas', `${shoot.folder}/${filename}`, 'NAS', size, null, now, capturedAt, hex(32), now, null)
      location.run(id, 'glacier', `originals/${id.slice(0, 2)}/${id}/${filename}`, 'DEEP_ARCHIVE', size, `${hex(16)}-${Math.ceil(size / 64e6)}`, now, null, null, null, due)
      rendition.run(id, 'thumb', `renditions/${id}/thumb.webp`, 480, 320, between(18, 45) * 1000, now)
      rendition.run(id, 'preview', `renditions/${id}/preview.webp`, 2048, 1365, between(250, 700) * 1000, now)
      // About four keywords a photo, as in the birds test set.
      for (const t of new Set([shoot.place.id, shoot.species.id, pick(tags.subjects).id, ...(rand() < 0.4 ? [shoot.client.id] : []), ...(rand() < 0.2 ? [pick(tags.events).id] : [])])) tag.run(id, t, now)
      bands(phash).forEach((value, i) => band.run(id, i, value))
      if ((n + 1) % 20_000 === 0) {
        db.sqlite.exec('COMMIT; BEGIN')
        say(`${(n + 1).toLocaleString()} photos`)
      }
    }
    db.sqlite.exec('COMMIT')
  })

  await time('albums', () => {
    const album = db.sqlite.prepare('INSERT INTO albums (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    const item = db.sqlite.prepare('INSERT OR IGNORE INTO album_items (album_id, asset_id, position, added_at) VALUES (?, ?, ?, ?)')
    db.sqlite.exec('BEGIN')
    const albums = Math.max(10, Math.round(options.photos / 700))
    for (let a = 0; a < albums; a++) {
      const id = hex(16)
      album.run(id, `Album ${a + 1}`, 'owner', now, now)
      const from = Math.floor(rand() * Math.max(1, ids.length - 300))
      for (let i = 0; i < between(20, 300); i++) item.run(id, ids[from + i]!, i, now)
    }
    db.sqlite.exec('COMMIT')
  })

  // The app's own search indexing, as the sweep would do after a rebuild.
  await time('search index', async () => {
    const d1 = asD1(db)
    for (let i = 0; i < ids.length; i += 500) {
      await indexAssets(d1, ids.slice(i, i + 500))
      db.take()
      if ((i + 500) % 50_000 === 0) say(`indexed ${(i + 500).toLocaleString()}`)
    }
  })
  return timings
}

function flipBits(hash: string, count: number): string {
  let bits = BigInt(`0x${hash}`)
  for (let i = 0; i < count; i++) bits ^= 1n << BigInt(Math.floor(rand() * 64))
  return bits.toString(16).padStart(16, '0')
}
