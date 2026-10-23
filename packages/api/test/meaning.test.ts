/**
 * Search by meaning (catalog/meaning.ts), with stand-ins: an "embedding" that counts words into a
 * vector, and an in-memory Vectorize. The real model's quality was measured separately (see MEANING_MODEL).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { buildWhere } from '../src/catalog/assets'
import { MEANING_MODEL, meaningText } from '../src/catalog/meaning'
import { indexAssets } from '../src/catalog/search'
import { runSweep } from '../src/catalog/sweeper'
import { createHarness, setUpAdmin, type Harness } from './harness'

let h: Harness
afterEach(async () => h?.dispose())

const DIMENSIONS = 1024
/** Each word lands in one of the vector's slots: texts sharing words point the same way. */
function wordVector(text: string): number[] {
  const v = new Array<number>(DIMENSIONS).fill(0)
  const words = text.replace(/^Instruct:[^\n]*\nQuery: /, '').toLowerCase().match(/[a-z]+/g) ?? []
  for (const w of words) {
    let n = 0
    for (const ch of w) n = (n * 31 + ch.charCodeAt(0)) % DIMENSIONS
    v[n]! += 1
  }
  const norm = Math.hypot(...v) || 1
  return v.map((x) => x / norm)
}

function fakeAi() {
  const calls: string[][] = []
  const ai = {
    async run(model: string, input: { text: string[] }) {
      if (model !== MEANING_MODEL) return { response: '{}' }
      calls.push(input.text)
      return { data: input.text.map(wordVector), shape: [input.text.length, DIMENSIONS] }
    },
  } as unknown as Ai
  return { ai, calls }
}

function fakeVectors() {
  const stored = new Map<string, number[]>()
  const index = {
    async upsert(vectors: { id: string; values: number[] }[]) {
      for (const v of vectors) stored.set(v.id, [...v.values])
      return { mutationId: 'm' }
    },
    async deleteByIds(ids: string[]) {
      for (const id of ids) stored.delete(id)
      return { mutationId: 'm' }
    },
    async getByIds(ids: string[]) {
      return ids.filter((id) => stored.has(id)).map((id) => ({ id, values: stored.get(id)! }))
    },
    async query(values: number[], options: { topK: number }) {
      const matches = [...stored].map(([id, v]) => ({ id, score: v.reduce((n, x, i) => n + x * values[i]!, 0) }))
      matches.sort((a, b) => b.score - a.score)
      return { matches: matches.slice(0, options.topK), count: matches.length }
    },
  } as unknown as Vectorize
  return { index, stored }
}

/** Ready photos with these titles and captions, in the search index. */
async function photos(items: [string, string, string][]): Promise<void> {
  const now = new Date().toISOString()
  for (const [id, title, caption] of items) {
    await h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, title, caption, created_at, updated_at) VALUES (?, ?, 'image/jpeg', 1, 'ready', ?, ?, ?, ?)")
      .bind(id, `${id}.jpg`, title, caption, now, now)
      .run()
  }
  await indexAssets(h.env.DB, items.map(([id]) => id))
}

const A = 'a'.repeat(32)
const B = 'b'.repeat(32)
const C = 'c'.repeat(32)
const D = 'd'.repeat(32)
const ids = async (path: string, cookie: string) => ((await (await h.fetch(path, { cookie })).json()) as { assets: { id: string }[] }).assets.map((a) => a.id)

describe('search by meaning', () => {
  it('finds photos by what was written about them, nearest first, and photos like one', async () => {
    const { ai, calls } = fakeAi()
    const { index } = fakeVectors()
    h = await createHarness({ AI: ai, VECTORS: index })
    const admin = await setUpAdmin(h)
    await photos([
      [A, 'Heron at dusk', 'A grey heron standing in shallow water'],
      [B, 'Egret', 'A grey egret standing in shallow water at the lake'],
      [C, 'Red car', 'A red sports car parked on a city street'],
      [D, '', ''],
    ])
    const sweep = await runSweep(h.env)
    expect(sweep.meant).toBe(3)

    expect(await ids(`/api/assets?meaning=${encodeURIComponent('heron in the water')}`, admin)).toEqual([A, B])
    expect(await ids(`/api/assets?like=${A}`, admin)).toEqual([B])
    // Narrowed by the other filters too.
    expect(await ids(`/api/assets?meaning=${encodeURIComponent('heron in the water')}&q=egret`, admin)).toEqual([B])

    // Indexed again with the same words: checked, but no new AI call.
    const before = calls.length
    await indexAssets(h.env.DB, [A, B, C])
    expect((await runSweep(h.env)).meant).toBe(0)
    expect(calls.length).toBe(before)

    // New words are embedded again.
    await h.env.DB.prepare('UPDATE assets SET caption = ? WHERE id = ?').bind('A red car by the water', C).run()
    await indexAssets(h.env.DB, [C])
    expect((await runSweep(h.env)).meant).toBe(1)
  })

  it('forgets deleted photos, and photos with nothing written about them', async () => {
    const { ai } = fakeAi()
    const { index, stored } = fakeVectors()
    h = await createHarness({ AI: ai, VECTORS: index })
    const admin = await setUpAdmin(h)
    await photos([
      [A, 'Heron', 'A heron in the water'],
      [B, 'Egret', 'An egret in the water'],
    ])
    await runSweep(h.env)
    expect([...stored.keys()].sort()).toEqual([A, B])

    expect((await h.fetch(`/api/assets/${A}`, { method: 'DELETE', cookie: admin })).status).toBe(204)
    await h.env.DB.prepare("UPDATE assets SET title = NULL, caption = NULL WHERE id = ?").bind(B).run()
    await indexAssets(h.env.DB, [A, B])
    await runSweep(h.env)
    expect([...stored.keys()]).toEqual([])
  })

  it('is absent without Vectorize, and a search by meaning nobody looked up never means everything', async () => {
    h = await createHarness()
    const admin = await setUpAdmin(h)
    await photos([[A, 'Heron', 'A heron in the water']])
    expect((await runSweep(h.env)).meant).toBe(0)
    expect(await ids('/api/assets?meaning=heron', admin)).toEqual([])
    expect(buildWhere({ meaning: 'heron' }).clause).toContain('0')
    expect(meaningText({ title: 'Heron', caption: null, tags: 'birds herons', place: 'Florida', ai: 'A bird' })).toBe('Heron. A bird. Keywords: birds herons. Florida')
  })
})
