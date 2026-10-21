import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BACKUP_CONFIG, setBackupConfig } from '../src/catalog/backups'
import { nearestPlace, parsePlaces, resetPlacesForTests } from '../src/catalog/places'
import { runSweep } from '../src/catalog/sweeper'
import { MIGRATIONS, migrate } from '../src/db/migrate'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const placesGz = readFileSync(new URL('../../../public/places/cities1000.tsv.gz', import.meta.url))
const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url))) // GPS 62.4667 N, 6.15 E
const iptc = new Uint8Array(readFileSync(new URL('./fixtures/iptc.jpg', import.meta.url))) // same GPS, but the file says Bergen

/** Serves the built place list the way the static-asset binding would. */
const ASSETS = { fetch: async () => new Response(placesGz) } as unknown as Fetcher

let h: Harness
let admin: string

async function upload(filename: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const created = (await (await h.fetch('/api/uploads', { ...json({ filename, size: bytes.byteLength, allowDuplicate: true }), cookie: admin })).json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}
const asset = async (id: string) =>
  (await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as { gps: { lat: number; lng: number } | null; iptc: Record<string, string | null>; placeFromGps: string[] }
const total = async (query: string) => ((await (await h.fetch(`/api/assets?${query}`, { cookie: admin })).json()) as { total: number }).total
const bulkGps = (ids: string[], lat: number | null, lng: number | null) => h.fetch('/api/assets/bulk', { ...json({ ids, action: 'gps', lat, lng }), cookie: admin })

describe('the place list', () => {
  it('finds the town, region and country', async () => {
    const text = await new Response(new Blob([placesGz]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    const index = parsePlaces(text)
    expect(nearestPlace(index, 60.3971, 5.3245)).toMatchObject({ city: 'Bergen', state: 'Vestland', country: 'Norway', countryCode: 'NO' })
    // The Eiffel Tower is nearer some Paris districts than to Paris's own point; the city wins.
    expect(nearestPlace(index, 48.8584, 2.2945)).toMatchObject({ city: 'Paris', country: 'France' })
    expect(nearestPlace(index, -33.8568, 151.2153)).toMatchObject({ city: 'Sydney', countryCode: 'AU' })
    // Across the antimeridian: Beringovskiy is at 179.35° E, the photo at 179.9° W (with a wider radius).
    expect(nearestPlace(index, 63.06, -179.9, 60)).toMatchObject({ city: 'Beringovskiy', countryCode: 'RU' })
    // Open ocean.
    expect(nearestPlace(index, 0, -30)).toBeNull()
  })
})

describe('filling in places from GPS', () => {
  beforeEach(async () => {
    h = await createHarness({ ASSETS })
    admin = await setUpAdmin(h)
  })
  afterEach(async () => h.dispose())

  it('fills city and country on upload, but never over what the file or a person said', async () => {
    const a = await upload('a.jpg', camera)
    expect(await asset(a)).toMatchObject({ placeFromGps: ['city', 'state', 'country', 'countryCode'], iptc: expect.objectContaining({ city: 'Ålesund', country: 'Norway', countryCode: 'NO' }) })
    expect(await total('q=ålesund')).toBe(1)
    const b = await upload('b.jpg', iptc)
    // The file says Bergen, the GPS Ålesund: nothing is filled from a lookup that disagrees with it.
    expect(await asset(b)).toMatchObject({ placeFromGps: [], iptc: expect.objectContaining({ city: 'Bergen', state: 'Vestland' }) })
  })

  it('places photos on the map, updates looked-up places when moved, and clears them when removed', async () => {
    const a = await upload('a.jpg', camera)
    const b = await upload('b.jpg', iptc)
    expect(await (await bulkGps([a, b], 59.9139, 10.7522)).json()).toEqual({ changed: 2 })
    expect((await asset(a)).iptc).toMatchObject({ city: 'Oslo', country: 'Norway' })
    expect((await asset(a)).gps).toEqual({ lat: 59.9139, lng: 10.7522 })
    expect((await asset(b)).iptc.city).toBe('Bergen') // the file's place stands

    expect((await bulkGps([a], 91, 0)).status).toBe(400)
    expect((await bulkGps([a], null, null)).status).toBe(200)
    expect(await asset(a)).toMatchObject({ gps: null, placeFromGps: [], iptc: expect.objectContaining({ city: null, country: null }) })
    expect(await total('gps=none')).toBe(1)
    expect(await total('gps=some')).toBe(1)
  })

  it('fills the rest of a place the file or a person gave part of, and keeps their part', async () => {
    const patch = (id: string, iptc: Record<string, string | null>) => h.fetch(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify({ iptc }), cookie: admin })
    const a = await upload('a.jpg', camera)
    // A sublocation typed by hand doesn't stop a move from updating the rest.
    expect((await patch(a, { sublocation: 'Brosundet' })).status).toBe(200)
    await bulkGps([a], 59.9139, 10.7522)
    expect(await asset(a)).toMatchObject({ placeFromGps: ['city', 'state', 'country', 'countryCode'], iptc: expect.objectContaining({ sublocation: 'Brosundet', city: 'Oslo', country: 'Norway' }) })

    // A country written by a person is theirs; the lookup still fills the city when it agrees.
    await patch(a, { country: 'NORWAY' })
    await bulkGps([a], 60.3913, 5.3221)
    expect(await asset(a)).toMatchObject({ placeFromGps: ['city', 'state', 'countryCode'], iptc: expect.objectContaining({ city: 'Bergen', country: 'NORWAY', countryCode: 'NO' }) })
    // Moved to Sweden: the looked-up places go, and Sweden contradicts their Norway, so none come back.
    await bulkGps([a], 59.3293, 18.0686)
    expect(await asset(a)).toMatchObject({ placeFromGps: [], iptc: expect.objectContaining({ sublocation: 'Brosundet', city: null, country: 'NORWAY', countryCode: null }) })
    // In other words, with a country code that agrees: filled.
    await patch(a, { country: 'Norge', countryCode: 'NO' })
    await bulkGps([a], 59.9139, 10.7522)
    expect(await asset(a)).toMatchObject({ placeFromGps: ['city', 'state'], iptc: expect.objectContaining({ city: 'Oslo', country: 'Norge', countryCode: 'NO' }) })

    // A preset (gently) and a file fill what was looked up, as if it were empty.
    const b = await upload('b.jpg', camera)
    const preset = (await (await h.fetch('/api/presets', { ...json({ name: 'Studio', fields: { city: 'Giske' } }), cookie: admin })).json()) as { preset: { id: string } }
    await h.fetch('/api/assets/bulk', { ...json({ ids: [b], action: 'preset', presetId: preset.preset.id }), cookie: admin })
    expect(await asset(b)).toMatchObject({ placeFromGps: ['state', 'country', 'countryCode'], iptc: expect.objectContaining({ city: 'Giske' }) })
  })

  it('looks up older photos in the sweep', async () => {
    const a = await upload('a.jpg', camera)
    await h.env.DB.prepare("UPDATE assets SET city = NULL, state = NULL, country = NULL, country_code = NULL, place_gps = 0, place_checked_at = NULL WHERE id = ?").bind(a).run()
    const sweep = await runSweep(h.env)
    expect(sweep.placed).toBe(1)
    expect((await asset(a)).iptc.city).toBe('Ålesund')
  })

  it('leaves photos for later, without rereading them every minute, while the place list is unavailable', async () => {
    const a = await upload('a.jpg', camera)
    await h.env.DB.prepare('UPDATE assets SET city = NULL, state = NULL, country = NULL, country_code = NULL, place_gps = 0, place_checked_at = NULL WHERE id = ?').bind(a).run()
    // The same database, now with a place list that won't load.
    h = { ...h, env: { ...h.env, ASSETS: { fetch: async () => new Response('', { status: 503 }) } as unknown as Fetcher } }
    resetPlacesForTests()
    // A fresh install's first sweep also starts the first catalog backup and whole-archive snapshot;
    // this is about places.
    await setBackupConfig(h.env.DB, { ...DEFAULT_BACKUP_CONFIG, connectionId: null })
    await h.env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('stats', '{}', ?)").bind(new Date().toISOString()).run()
    // A quiet minute: on the hour the sweep also tidies abandoned archive uploads, and every five
    // minutes it looks for problems.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T10:31:00Z'))
    const quiet = await h.count(() => runSweep(h.env)).finally(() => vi.useRealTimers())
    expect(quiet.roundTrips).toBeLessThan(15)
    expect((await h.env.DB.prepare('SELECT place_checked_at FROM assets WHERE id = ?').bind(a).first<{ place_checked_at: string | null }>())?.place_checked_at).toBeNull()
  })
})

describe('migration 0023', () => {
  it('marks places looked up before it, and looks again where part of a place blocked the lookup', async () => {
    const old = await createHarness({ ASSETS }, { migrations: MIGRATIONS.filter((m) => m.name < '0023') })
    try {
      const row = (id: string, gps: boolean, city: string | null, country: string | null, source: string | null) =>
        old.env.DB.prepare(
          `INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at, gps_lat, gps_lng, city, country, location_source, place_checked_at)
           VALUES (?, 'x.jpg', 'image/jpeg', 1, 'ready', 'x', 'x', ?, ?, ?, ?, ?, 'x')`,
        ).bind(id, gps ? 62.4667 : null, gps ? 6.15 : null, city, country, source)
      await old.env.DB.batch([
        row('looked-up', true, 'Ålesund', 'Norway', 'gps'),
        row('country-only', true, null, 'Norway', 'file'),
        row('whole', false, 'Bergen', 'Norway', 'file'),
      ])
      await migrate(old.env.DB, MIGRATIONS)
      const { results } = await old.env.DB.prepare('SELECT id, place_gps, place_checked_at FROM assets ORDER BY id').all<{ id: string; place_gps: number; place_checked_at: string | null }>()
      expect(results).toEqual([
        { id: 'country-only', place_gps: 0, place_checked_at: null },
        { id: 'looked-up', place_gps: 5, place_checked_at: 'x' },
        { id: 'whole', place_gps: 0, place_checked_at: 'x' },
      ])
      expect((await runSweep(old.env)).placed).toBe(1)
      expect(await old.env.DB.prepare("SELECT city, country, place_gps FROM assets WHERE id = 'country-only'").first()).toEqual({ city: 'Ålesund', country: 'Norway', place_gps: 11 })
    } finally {
      await old.dispose()
    }
  })
})
