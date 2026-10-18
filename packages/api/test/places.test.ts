import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nearestPlace, parsePlaces, resetPlacesForTests } from '../src/catalog/places'
import { runSweep } from '../src/catalog/sweeper'
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
  (await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as { gps: { lat: number; lng: number } | null; iptc: Record<string, string | null>; locationSource: string | null }
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
    expect(await asset(a)).toMatchObject({ locationSource: 'gps', iptc: expect.objectContaining({ city: 'Ålesund', country: 'Norway', countryCode: 'NO' }) })
    expect(await total('q=ålesund')).toBe(1)
    const b = await upload('b.jpg', iptc)
    expect((await asset(b)).iptc.city).toBe('Bergen')
    expect((await asset(b)).locationSource).toBe('file')
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
    expect(await asset(a)).toMatchObject({ gps: null, locationSource: null, iptc: expect.objectContaining({ city: null, country: null }) })
    expect(await total('gps=none')).toBe(1)
    expect(await total('gps=some')).toBe(1)
  })

  it('looks up older photos in the sweep', async () => {
    const a = await upload('a.jpg', camera)
    await h.env.DB.prepare("UPDATE assets SET city = NULL, state = NULL, country = NULL, country_code = NULL, location_source = NULL, place_checked_at = NULL WHERE id = ?").bind(a).run()
    const sweep = await runSweep(h.env)
    expect(sweep.placed).toBe(1)
    expect((await asset(a)).iptc.city).toBe('Ålesund')
  })

  it('leaves photos for later, without rereading them every minute, while the place list is unavailable', async () => {
    const a = await upload('a.jpg', camera)
    await h.env.DB.prepare('UPDATE assets SET city = NULL, state = NULL, country = NULL, country_code = NULL, location_source = NULL, place_checked_at = NULL WHERE id = ?').bind(a).run()
    // The same database, now with a place list that won't load.
    h = { ...h, env: { ...h.env, ASSETS: { fetch: async () => new Response('', { status: 503 }) } as unknown as Fetcher } }
    resetPlacesForTests()
    const quiet = await h.count(() => runSweep(h.env))
    expect(quiet.roundTrips).toBeLessThan(15)
    expect((await h.env.DB.prepare('SELECT place_checked_at FROM assets WHERE id = ?').bind(a).first<{ place_checked_at: string | null }>())?.place_checked_at).toBeNull()
  })
})
