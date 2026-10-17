/**
 * Reverse geocoding without an outside service: the nearest of GeoNames' ~170,000 places with 1,000+
 * people (CC BY 4.0), shipped as a static asset (public/places/cities1000.tsv.gz, built by
 * scripts/build-places.mjs) and loaded once per isolate into a 1° grid.
 *
 * Fills city, region and country only where a file or a person hasn't, and marks them as 'gps' so a
 * later move of the photo's pin can replace them.
 */
import type { DamBindings } from '../env'
import { nowIso } from '../lib/time'

export const PLACES_PATH = '/places/cities1000.tsv.gz'
/** Further than this from any listed place (open sea, wilderness) and nothing is filled in. */
export const MAX_PLACE_KM = 30
/**
 * Big cities are listed alongside their districts ("Paris" and "Paris 16 Passy"), so the nearest point
 * is often a district. Among places this much further away than the nearest, the most populous wins.
 */
export const PREFER_LARGER_WITHIN_KM = 5

export interface Place {
  city: string
  state: string | null
  country: string | null
  countryCode: string
  km: number
}

interface PlaceIndex {
  lat: Float32Array
  lng: Float32Array
  name: string[]
  cc: string[]
  admin: string[]
  population: Uint32Array
  countries: Map<string, string>
  regions: Map<string, string>
  grid: Map<number, number[]>
}

const cellOf = (lat: number, lng: number) => (Math.floor(lat) + 90) * 1000 + (Math.floor(lng) + 180)

export function parsePlaces(text: string): PlaceIndex {
  const lines = text.split('\n')
  const countries = new Map<string, string>()
  const regions = new Map<string, string>()
  const lat: number[] = []
  const lng: number[] = []
  const name: string[] = []
  const cc: string[] = []
  const admin: string[] = []
  const population: number[] = []
  for (const line of lines) {
    const f = line.split('\t')
    if (f[0] === 'C') countries.set(f[1]!, f[2]!)
    else if (f[0] === 'A') regions.set(f[1]!, f[2]!)
    else if (f.length >= 4) {
      lat.push(Number(f[0]))
      lng.push(Number(f[1]))
      name.push(f[2]!)
      cc.push(f[3]!)
      admin.push(f[4] ?? '')
      population.push(Number(f[5]) || 0)
    }
  }
  const grid = new Map<number, number[]>()
  for (let i = 0; i < lat.length; i++) {
    const key = cellOf(lat[i]!, lng[i]!)
    const cell = grid.get(key)
    cell ? cell.push(i) : grid.set(key, [i])
  }
  return { lat: Float32Array.from(lat), lng: Float32Array.from(lng), name, cc, admin, population: Uint32Array.from(population), countries, regions, grid }
}

function km(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function nearestPlace(index: PlaceIndex, latitude: number, longitude: number, maxKm = MAX_PLACE_KM): Place | null {
  const candidates: { i: number; d: number }[] = []
  const baseLat = Math.floor(latitude)
  const baseLng = Math.floor(longitude)
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      // Wrap longitude across the antimeridian.
      const cellLng = ((baseLng + dLng + 180 + 360) % 360) - 180
      for (const i of index.grid.get(cellOf(baseLat + dLat, cellLng)) ?? []) {
        const d = km(latitude, longitude, index.lat[i]!, index.lng[i]!)
        if (d <= maxKm) candidates.push({ i, d })
      }
    }
  }
  if (candidates.length === 0) return null
  const nearest = Math.min(...candidates.map((c) => c.d))
  const { i: best, d: bestKm } = candidates
    .filter((c) => c.d <= nearest + PREFER_LARGER_WITHIN_KM)
    .reduce((a, b) => (index.population[b.i]! > index.population[a.i]! ? b : a))
  const code = index.cc[best]!
  return {
    city: index.name[best]!,
    state: index.regions.get(`${code}.${index.admin[best]}`) ?? null,
    country: index.countries.get(code) ?? null,
    countryCode: code,
    km: Math.round(bestKm * 10) / 10,
  }
}

let loading: Promise<PlaceIndex | null> | null = null

/** The place index, loaded from the static asset once per isolate. Null when it isn't available. */
export function placeIndex(env: DamBindings): Promise<PlaceIndex | null> {
  // The static-asset binding exists in deployed Workers; `astro dev` has none, so there is no lookup there.
  if (!env.ASSETS) return Promise.resolve(null)
  loading ??= (async () => {
    try {
      const res = await env.ASSETS!.fetch(new Request(`https://assets.local${PLACES_PATH}`))
      if (!res.ok || !res.body) {
        console.warn('[places] the place list is unavailable', res.status)
        return null
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      // Served either as the raw .gz or already decoded, depending on the asset server.
      const gz = bytes[0] === 0x1f && bytes[1] === 0x8b
      const text = gz ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(bytes)
      return parsePlaces(text)
    } catch (error) {
      console.warn('[places] could not load the place list', error)
      return null
    }
  })()
  const current = loading
  // A failed load is retried by the next caller rather than remembered.
  void current.then((index) => {
    if (!index && loading === current) loading = null
  })
  return current
}

export function resetPlacesForTests(): void {
  loading = null
}

/**
 * Fill city, region and country from GPS for these assets, where nobody (file or person) set them.
 * Places that came from an earlier GPS lookup are replaced, so moving a pin updates them.
 */
export async function fillPlacesFromGps(env: DamBindings, assetIds: string[]): Promise<number> {
  if (assetIds.length === 0) return 0
  const index = await placeIndex(env)
  if (!index) return 0
  let filled = 0
  for (let i = 0; i < assetIds.length; i += 90) {
    const slice = assetIds.slice(i, i + 90)
    const { results } = await env.DB.prepare(
      `SELECT id, gps_lat, gps_lng, location_source, city, state, country FROM assets WHERE id IN (${slice.map(() => '?').join(',')})`,
    )
      .bind(...slice)
      .all<{ id: string; gps_lat: number | null; gps_lng: number | null; location_source: string | null; city: string | null; state: string | null; country: string | null }>()
    const now = nowIso()
    const statements: D1PreparedStatement[] = []
    for (const row of results) {
      const ownedElsewhere = row.location_source === 'file' || row.location_source === 'user' || (!row.location_source && (row.city || row.state || row.country))
      const place = row.gps_lat !== null && row.gps_lng !== null && !ownedElsewhere ? nearestPlace(index, row.gps_lat, row.gps_lng) : null
      if (place) {
        filled++
        statements.push(
          env.DB.prepare(
            `UPDATE assets SET city = ?, state = ?, country = ?, country_code = ?, location_source = 'gps', place_checked_at = ? WHERE id = ?`,
          ).bind(place.city, place.state, place.country, place.countryCode, now, row.id),
        )
      } else {
        statements.push(env.DB.prepare('UPDATE assets SET place_checked_at = ? WHERE id = ?').bind(now, row.id))
      }
    }
    if (statements.length > 0) await env.DB.batch(statements)
  }
  return filled
}
