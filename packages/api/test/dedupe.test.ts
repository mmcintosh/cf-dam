import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bands, hamming, MAX_DISTANCE } from '../src/catalog/phash'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

describe('the hash', () => {
  it('counts differing bits', () => {
    expect(hamming('0000000000000000', '0000000000000000')).toBe(0)
    expect(hamming('ffffffffffffffff', '0000000000000000')).toBe(64)
    expect(hamming('8000000000000001', '0000000000000000')).toBe(2)
  })

  it('always shares a band with any hash within MAX_DISTANCE bits (so lookups never miss)', () => {
    for (let trial = 0; trial < 500; trial++) {
      let bits = 0n
      for (let i = 0; i < 64; i++) bits = (bits << 1n) | (Math.random() < 0.5 ? 1n : 0n)
      let other = bits
      const flips = new Set<number>()
      while (flips.size < MAX_DISTANCE) flips.add(Math.floor(Math.random() * 64))
      for (const bit of flips) other ^= 1n << BigInt(bit)
      const a = bits.toString(16).padStart(16, '0')
      const b = other.toString(16).padStart(16, '0')
      expect(hamming(a, b)).toBe(MAX_DISTANCE)
      const [ba, bb] = [bands(a), bands(b)]
      expect(ba.some((v, i) => v === bb[i])).toBe(true)
    }
  })
})

let h: Harness
let admin: string
beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

async function upload(filename: string, bytes: Uint8Array<ArrayBuffer>, sha256?: string): Promise<string> {
  const res = await h.fetch('/api/uploads', { ...json({ filename, size: bytes.byteLength, sha256, allowDuplicate: true }), cookie: admin })
  const created = (await res.json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

async function variant(transform: Record<string, unknown>): Promise<Uint8Array<ArrayBuffer>> {
  const out = await h.env.IMAGES!.input(new Blob([camera]).stream()).transform(transform).output({ format: 'image/jpeg', quality: 70 })
  return new Uint8Array(await out.response().arrayBuffer())
}

const sha = async (b: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('')

describe('duplicates', () => {
  it('groups exact copies by content hash', async () => {
    const hash = await sha(camera)
    const a = await upload('original.jpg', camera, hash)
    const b = await upload('copy of original.jpg', camera, hash)
    const { groups, total } = (await (await h.fetch('/api/duplicates/exact', { cookie: admin })).json()) as { groups: { assets: { id: string }[] }[]; total: number }
    expect(total).toBe(1)
    expect(groups[0]!.assets.map((x) => x.id).sort()).toEqual([a, b].sort())
  })

  it('finds a resized, recompressed copy as a look-alike, but not a rotated photo', async () => {
    const a = await upload('IMG_1.jpg', camera)
    const resized = await upload('IMG_1-web.jpg', await variant({ width: 600 }))
    const rotated = await upload('IMG_1-rotated.jpg', await variant({ rotate: 90 }))
    const hashes = await h.env.DB.prepare('SELECT id, phash FROM assets').all<{ id: string; phash: string | null }>()
    expect(hashes.results.every((r) => r.phash && /^[0-9a-f]{16}$/.test(r.phash))).toBe(true)

    const { groups } = (await (await h.fetch('/api/duplicates/similar', { cookie: admin })).json()) as { groups: { assets: { id: string; width: number }[] }[] }
    expect(groups).toHaveLength(1)
    expect(groups[0]!.assets.map((x) => x.id).sort()).toEqual([a, resized].sort())
    expect(groups[0]!.assets[0]!.id).toBe(a) // the bigger one is suggested first
    expect(groups[0]!.assets.map((x) => x.id)).not.toContain(rotated)
  })

  it('keeps one and folds the others’ tags, albums, rating and pick into it', async () => {
    const a = await upload('keeper.jpg', camera)
    const b = await upload('keeper-web.jpg', await variant({ width: 600 }))
    const { album } = (await (await h.fetch('/api/albums', { ...json({ name: 'Portfolio' }), cookie: admin })).json()) as { album: { id: string } }
    await h.fetch('/api/assets/bulk', { ...json({ ids: [b], action: 'tag-add', tags: ['client-favourite'] }), cookie: admin })
    await h.fetch('/api/assets/bulk', { ...json({ ids: [b], action: 'album-add', albumId: album.id }), cookie: admin })
    await h.fetch('/api/assets/bulk', { ...json({ ids: [b], action: 'rating', rating: 5 }), cookie: admin })
    await h.fetch('/api/assets/bulk', { ...json({ ids: [b], action: 'flag', flag: 'pick' }), cookie: admin })

    const res = await h.fetch('/api/duplicates/resolve', { ...json({ keep: a, remove: [b] }), cookie: admin })
    expect(await res.json()).toEqual({ removed: 1 })
    const kept = (await (await h.fetch(`/api/assets/${a}`, { cookie: admin })).json()) as { rating: number; flag: string; tags: { name: string }[] }
    expect(kept).toMatchObject({ rating: 5, flag: 'pick' })
    expect(kept.tags.map((t) => t.name)).toContain('client-favourite')
    expect(((await (await h.fetch(`/api/assets?album=${album.id}`, { cookie: admin })).json()) as { assets: { id: string }[] }).assets.map((x) => x.id)).toEqual([a])
    expect((await h.fetch(`/api/assets/${b}`, { cookie: admin })).status).toBe(404)
    expect(((await (await h.fetch('/api/duplicates/similar', { cookie: admin })).json()) as { total: number }).total).toBe(0)
  })

  it('stops showing look-alikes someone marked as not duplicates', async () => {
    const a = await upload('burst-1.jpg', camera)
    const b = await upload('burst-2.jpg', await variant({ width: 600 }))
    expect(await (await h.fetch('/api/duplicates/dismiss', { ...json({ ids: [a, b] }), cookie: admin })).json()).toEqual({ dismissed: 1 })
    expect(await (await h.fetch('/api/duplicates/counts', { cookie: admin })).json()).toEqual({ exact: 0, similar: 0 })
  })
})

describe('shape guard', () => {
  it('does not pair a panorama crop with the full frame, even when the tones match', async () => {
    const full = await upload('frame.jpg', camera)
    const out = await h.env.IMAGES!.input(new Blob([camera]).stream()).transform({ width: 1200, height: 400, fit: 'squeeze' }).output({ format: 'image/jpeg' })
    const stretched = await upload('frame-stretched.jpg', new Uint8Array(await out.response().arrayBuffer()))
    const pairs = await h.env.DB.prepare('SELECT COUNT(*) AS n FROM similar_pairs').first<{ n: number }>()
    expect(pairs?.n).toBe(0)
    expect([full, stretched]).toHaveLength(2)
  })
})

describe('grouping', () => {
  it('builds groups around a centre instead of chaining A~B~C', async () => {
    const now = new Date().toISOString()
    const ids = ['p1', 'p2', 'p3', 'p4']
    await h.env.DB.batch([
      ...ids.map((id) => h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) VALUES (?, ?, 'image/jpeg', 1, 'ready', ?, ?)").bind(id, `${id}.jpg`, now, now)),
      // p1 is like p2 and p3; p3 is also like p4, but p4 is not like p1.
      ...[['p1', 'p2'], ['p1', 'p3'], ['p3', 'p4']].map(([a, b]) => h.env.DB.prepare('INSERT INTO similar_pairs (a, b, distance, created_at) VALUES (?, ?, 1, ?)').bind(a, b, now)),
    ])
    const { groups } = (await (await h.fetch('/api/duplicates/similar', { cookie: admin })).json()) as { groups: { assets: { id: string }[] }[] }
    const sets = groups.map((g) => g.assets.map((a) => a.id).sort())
    expect(sets).toContainEqual(['p1', 'p2', 'p3'])
    expect(sets.flat().filter((id) => id === 'p4')).toHaveLength(0)
  })
})

describe('taking one photo out of a group', () => {
  it('dismisses only that photo’s pairs, leaving the rest grouped', async () => {
    const now = new Date().toISOString()
    await h.env.DB.batch([
      ...['q1', 'q2', 'q3'].map((id) => h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) VALUES (?, ?, 'image/jpeg', 1, 'ready', ?, ?)").bind(id, `${id}.jpg`, now, now)),
      ...[['q1', 'q2'], ['q1', 'q3'], ['q2', 'q3']].map(([a, b]) => h.env.DB.prepare('INSERT INTO similar_pairs (a, b, distance, created_at) VALUES (?, ?, 1, ?)').bind(a, b, now)),
    ])
    expect(await (await h.fetch('/api/duplicates/dismiss', { ...json({ ids: ['q1', 'q2', 'q3'], only: 'q3' }), cookie: admin })).json()).toEqual({ dismissed: 2 })
    const { groups } = (await (await h.fetch('/api/duplicates/similar', { cookie: admin })).json()) as { groups: { assets: { id: string }[] }[] }
    expect(groups.map((g) => g.assets.map((a) => a.id).sort())).toEqual([['q1', 'q2']])
  })
})
