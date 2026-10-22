/**
 * Review step 5: AI analysis that can't pay twice or forever (B6, B7), and look-alikes that don't
 * pair every plain picture with every other (B9).
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { runSweep } from '../src/catalog/sweeper'
import { recordHashes, MAX_PAIRS_PER_PHOTO } from '../src/catalog/phash'
import { analyzeImage, extractJson } from '../src/catalog/vision'
import { pairPlainHashes, unpairPlainHashes } from '../src/db/repairs'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))
const REPLY = { tags: ['coast'], alt: 'A coast', caption: 'Coast.', description: 'Rocks and sea.', people: 0, quality: 'good', text: '' }

/** Like the real binding: a class with a private field. `answer` decides each call. */
function fakeAi(answer: () => Promise<unknown>) {
  let calls = 0
  class FakeAi {
    #answer = answer
    async run() {
      calls++
      return this.#answer()
    }
  }
  return { ai: new FakeAi() as unknown as Ai, calls: () => calls }
}

let h: Harness
afterEach(async () => h?.dispose())

async function upload(admin: string): Promise<string> {
  const res = await h.fetch('/api/uploads', { ...json({ filename: 'IMG_1.jpg', size: camera.byteLength, allowDuplicate: true }), cookie: admin })
  const { uploadId } = (await res.json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

const row = (id: string) => h.env.DB.prepare('SELECT ai_status, ai_attempts, ai_error FROM assets WHERE id = ?').bind(id).first<{ ai_status: string; ai_attempts: number; ai_error: string | null }>()

describe('AI analysis', () => {
  it('runs once when “Analyse” is clicked twice', async () => {
    const reply = { choices: [{ message: { content: JSON.stringify(REPLY) } }] }
    const { ai, calls } = fakeAi(() => new Promise((r) => setTimeout(() => r(reply), 400)))
    h = await createHarness({ AI: ai })
    const admin = await setUpAdmin(h)
    const id = await upload(admin)
    const both = await Promise.all([1, 2].map(() => h.fetch(`/api/assets/${id}/ai/analyze`, { method: 'POST', cookie: admin })))
    expect(both.map((r) => r.status).sort()).toEqual([200, 409])
    expect(calls()).toBe(1)
  })

  it('is given up on by a backfill after three billed failures, until someone queues the photo again', async () => {
    const { ai, calls } = fakeAi(async () => ({ choices: [{ message: { content: '{"tags": ["sign", "text": "A VERY LONG SIGN' } }] }))
    h = await createHarness({ AI: ai })
    const admin = await setUpAdmin(h)
    const id = await upload(admin)
    await h.env.DB.prepare('UPDATE assets SET ai_status = NULL').run()
    for (let i = 0; i < 3; i++) {
      expect((await (await h.fetch('/api/ai/backfill', { method: 'POST', cookie: admin })).json()) as { queued: number }).toMatchObject({ queued: 1 })
      await runSweep(h.env)
    }
    expect(await row(id)).toMatchObject({ ai_status: 'failed', ai_attempts: 3, ai_error: 'The model’s reply was cut off before the end.' })
    expect((await (await h.fetch('/api/ai/backfill', { method: 'POST', cookie: admin })).json()) as { queued: number }).toMatchObject({ queued: 0 })
    expect(calls()).toBe(3)
    // Chosen by hand: tried again.
    await h.fetch('/api/assets/bulk', { ...json({ ids: [id], action: 'ai-queue' }), cookie: admin })
    expect(await row(id)).toMatchObject({ ai_status: 'queued', ai_attempts: 0 })
  })

  it('puts a photo a dead run left “running” back while it has tries left, then gives up', async () => {
    const { ai } = fakeAi(async () => ({ choices: [{ message: { content: JSON.stringify(REPLY) } }] }))
    h = await createHarness({ AI: ai })
    const admin = await setUpAdmin(h)
    const id = await upload(admin)
    const stuck = (attempts: number) =>
      h.env.DB.prepare("UPDATE assets SET ai_status = 'running', ai_started_at = '2020-01-01T00:00:00Z', ai_attempts = ? WHERE id = ?").bind(attempts, id).run()
    await stuck(3)
    await runSweep(h.env)
    expect(await row(id)).toMatchObject({ ai_status: 'failed', ai_error: 'The analysis didn’t finish, 3 times.' })
    await stuck(1)
    await runSweep(h.env)
    expect((await row(id))!.ai_status).not.toBe('running')
    expect((await row(id))!.ai_status).not.toBe('failed')
  })

  it('stops waiting for a model that doesn’t answer, and says when a reply was cut off', async () => {
    const { ai } = fakeAi(() => new Promise(() => {}))
    await expect(analyzeImage(ai, '@cf/mistralai/mistral-small-3.1-24b-instruct', 'data:image/jpeg;base64,', {}, 50)).rejects.toThrow('didn’t answer within')
    expect(() => extractJson('{"tags": ["a", "b"')).toThrow('cut off')
    expect(() => extractJson('no json here')).toThrow('did not return JSON')
  })
})

describe('look-alikes', () => {
  async function photos(n: number, prefix = 'p') {
    const now = new Date().toISOString()
    const ids = Array.from({ length: n }, (_, i) => `${prefix}${i}`)
    await h.env.DB.prepare(
      `INSERT INTO assets (id, filename, mime_type, status, width, height, created_at, updated_at)
       SELECT value, value || '.jpg', 'image/jpeg', 'ready', 3000, 2000, ?, ? FROM json_each(?)`,
    )
      .bind(now, now, JSON.stringify(ids))
      .run()
    return ids
  }
  const flip = (hash: string, bit: number) => {
    const n = BigInt(`0x${hash}`) ^ (1n << BigInt(bit))
    return n.toString(16).padStart(16, '0')
  }
  const pairCount = async () => (await h.env.DB.prepare('SELECT COUNT(*) AS n FROM similar_pairs').first<{ n: number }>())!.n

  it('doesn’t pair plain pictures (black frames, blank pages) with each other', async () => {
    h = await createHarness()
    const ids = await photos(8)
    // Hashes of 0–3 bits: all within 5 bits of each other.
    expect(await recordHashes(h.env.DB, ids.map((id, i) => ({ id, hash: i.toString(16).padStart(16, '0') })))).toBe(0)
    expect(await pairCount()).toBe(0)
  })

  it('pairs a plain picture only with the same hash at the same size, never blank ones or videos', async () => {
    h = await createHarness()
    const ids = await photos(7)
    await h.env.DB.batch([
      h.env.DB.prepare("UPDATE assets SET width = 407, height = 407 WHERE id IN ('p0', 'p1', 'p2', 'p4', 'p5', 'p6')"),
      h.env.DB.prepare("UPDATE assets SET mime_type = 'video/mp4' WHERE id = 'p6'"),
    ])
    const sky = '0000003020000000'
    // p0 and p1: a re-saved sky. p2 a different sky, p3 the same at 3000×2000, p4 and p5 blank, p6 a video.
    const hashes = [sky, sky, '0000003020000001', sky, '0'.repeat(16), '0'.repeat(16), sky]
    expect(await recordHashes(h.env.DB, ids.map((id, i) => ({ id, hash: hashes[i]! })))).toBe(1)
    expect((await h.env.DB.prepare('SELECT a, b, distance FROM similar_pairs').all()).results).toEqual([{ a: 'p0', b: 'p1', distance: 0 }])
  })

  it('pairs the plain pictures hashed before (0038), leaving dismissed pairs dismissed', async () => {
    h = await createHarness()
    await photos(4, 'old')
    await h.env.DB.batch([
      h.env.DB.prepare("UPDATE assets SET phash = '0000003020000000' WHERE id IN ('old0', 'old1', 'old2')"),
      h.env.DB.prepare("UPDATE assets SET phash = 'f0f0f0f0f0f0f0f0' WHERE id = 'old3'"),
      h.env.DB.prepare("INSERT INTO similar_pairs (a, b, distance, dismissed, created_at) VALUES ('old0', 'old2', 0, 1, '2026-01-01')"),
    ])
    await pairPlainHashes(h.env.DB)
    await pairPlainHashes(h.env.DB)
    expect((await h.env.DB.prepare('SELECT a, b, dismissed FROM similar_pairs ORDER BY a, b').all()).results).toEqual([
      { a: 'old0', b: 'old1', dismissed: 0 },
      { a: 'old0', b: 'old2', dismissed: 1 },
      { a: 'old1', b: 'old2', dismissed: 0 },
    ])
  })

  it('keeps the nearest look-alikes of a photo, not every frame of a burst', async () => {
    h = await createHarness()
    const base = 'f0f0f0f0f0f0f0f0'
    const burst = await photos(60, 'b')
    await recordHashes(h.env.DB, burst.map((id, i) => ({ id, hash: flip(base, i) })))
    const [me] = await photos(1, 'me')
    expect(await recordHashes(h.env.DB, [{ id: me!, hash: base }])).toBe(MAX_PAIRS_PER_PHOTO)
  })

  it('drops pairs plain hashes made before (0022), but not dismissed ones', async () => {
    h = await createHarness()
    await photos(3, 'old')
    await h.env.DB.batch([
      h.env.DB.prepare("UPDATE assets SET phash = '0000000000000001' WHERE id IN ('old0', 'old1')"),
      h.env.DB.prepare("UPDATE assets SET phash = 'f0f0f0f0f0f0f0f0' WHERE id = 'old2'"),
      h.env.DB.prepare("INSERT INTO similar_pairs (a, b, distance, dismissed, created_at) VALUES ('old0', 'old1', 1, 0, '2026-01-01'), ('old0', 'old2', 4, 1, '2026-01-01')"),
      h.env.DB.prepare("INSERT INTO asset_hash_bands (asset_id, band, value) VALUES ('old0', 0, 'x'), ('old2', 0, 'y')"),
    ])
    await unpairPlainHashes(h.env.DB)
    expect((await h.env.DB.prepare('SELECT a, b FROM similar_pairs').all()).results).toEqual([{ a: 'old0', b: 'old2' }])
    expect((await h.env.DB.prepare('SELECT asset_id FROM asset_hash_bands').all()).results).toEqual([{ asset_id: 'old2' }])
  })
})
