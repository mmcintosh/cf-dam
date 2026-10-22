import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bands, hamming, MAX_DISTANCE } from '../src/catalog/phash'
import { fillQuickHashes } from '../src/catalog/duplicates'
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

async function variant(transform: Record<string, unknown>, quality = 70): Promise<Uint8Array<ArrayBuffer>> {
  const out = await h.env.IMAGES!.input(new Blob([camera]).stream()).transform(transform).output({ format: 'image/jpeg', quality })
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

  it('knows a helper’s photo and an upload of the same file as one, at upload and on the page', async () => {
    // A helper indexed it: no SHA-256, only its quick fingerprint (as the browser computes it too).
    const quick = 'ab'.repeat(32)
    await h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, quick_hash, status, created_at, updated_at) VALUES ('nas', 'IMG_1.jpg', 'image/jpeg', ?, ?, 'ready', '2020-01-01', '2020-01-01')")
      .bind(camera.byteLength, quick)
      .run()
    const again = await h.fetch('/api/uploads', { ...json({ filename: 'IMG_1.jpg', size: camera.byteLength, sha256: await sha(camera), quickHash: quick }), cookie: admin })
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ error: 'duplicate', duplicateOf: 'nas' })

    // Uploaded anyway: one exact group, the helper's copy suggested as it came first.
    const res = await h.fetch('/api/uploads', { ...json({ filename: 'IMG_1 copy.jpg', size: camera.byteLength, quickHash: quick, allowDuplicate: true }), cookie: admin })
    const created = (await res.json()) as { assetId: string }
    await h.env.DB.prepare("UPDATE assets SET status = 'ready' WHERE id = ?").bind(created.assetId).run()
    const { groups, total } = (await (await h.fetch('/api/duplicates/exact', { cookie: admin })).json()) as { groups: { assets: { id: string }[]; reason: string }[]; total: number }
    expect(total).toBe(1)
    expect(groups[0]!.assets.map((x) => x.id)).toEqual(['nas', created.assetId])
    expect(groups[0]!.reason).toBe('Identical files: the one that came in first')
  })

  it('fills in the fingerprints of photos a helper indexed before, then stops', async () => {
    const quick = 'cd'.repeat(32)
    await h.env.DB.batch([
      h.env.DB.prepare("INSERT INTO storage_connections (id, name, provider, auth_mode, storage_classes, default_class, is_default, created_at, updated_at) VALUES ('nas-s1', 'NAS', 'nas', 'agent', '[\"NAS\"]', 'NAS', 0, 'x', 'x')"),
      ...['old-1', 'old-2'].map((id) =>
        h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) VALUES (?, 'IMG_1.jpg', 'image/jpeg', 10, 'ready', 'x', 'x')").bind(id),
      ),
      ...['old-1', 'old-2'].map((id) =>
        h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, quick_hash, updated_at) VALUES (?, 'nas-s1', ?, 'NAS', 'present', ?, 'x')").bind(id, `/p/${id}.jpg`, quick),
      ),
    ])
    expect(((await (await h.fetch('/api/duplicates/exact', { cookie: admin })).json()) as { total: number }).total).toBe(0)
    expect(await fillQuickHashes(h.env.DB, () => true)).toBe(2)
    expect(await h.env.DB.prepare("SELECT 1 FROM settings WHERE key = 'quick_hash.fill'").first()).toBeNull()
    const { groups } = (await (await h.fetch('/api/duplicates/exact', { cookie: admin })).json()) as { groups: { assets: { id: string }[] }[] }
    expect(groups.map((g) => g.assets.map((a) => a.id).sort())).toEqual([['old-1', 'old-2']])
    expect(await fillQuickHashes(h.env.DB, () => true)).toBe(0)
  })

  it('suggests the less compressed of two look-alikes the same size, and says why', async () => {
    const resaved = await variant({})
    expect(resaved.byteLength).toBeLessThan(camera.byteLength / 1.05)
    const low = await upload('IMG_1-resaved.jpg', resaved)
    const high = await upload('IMG_1.jpg', camera)
    const { groups } = (await (await h.fetch('/api/duplicates/similar', { cookie: admin })).json()) as { groups: { assets: { id: string; width: number }[]; reason: string }[] }
    expect(groups).toHaveLength(1)
    expect(groups[0]!.assets[0]!.width).toBe(groups[0]!.assets[1]!.width)
    expect(groups[0]!.assets.map((x) => x.id)).toEqual([high, low])
    expect(groups[0]!.reason).toMatch(/^The same size, but less compressed \(/)
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
    expect((groups[0] as unknown as { reason: string }).reason).toBe('More pixels')
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
