import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FACET_MAX_ATTEMPTS, FACET_RETRY_MS, facetAsset, facetsSweep, peopleValue } from '../src/catalog/jev-facets'
import { statsStep } from '../src/catalog/stats'
import { runSweep } from '../src/catalog/sweeper'
import { doWork } from '../src/catalog/work'
import { decide } from '../src/lib/jev/facets'
import { FACETS } from '../src/lib/jev/questions'
import { ENDPOINT, TypeSafeRefused, typesafe } from '../src/lib/jev/typesafe'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

let h: Harness
afterEach(async () => {
  vi.restoreAllMocks()
  await h?.dispose()
})

/** Every yes/no question answered `noul`, the choices as given. */
function answers(nouls: Record<string, number>, choices: Record<string, [string, number]> = {}) {
  const out: Record<string, unknown> = {}
  for (const [id, q] of Object.entries(FACETS)) {
    if (q.type === 'noul') out[id] = { noul: nouls[id] ?? 0.05 }
    else {
      const keys = Object.keys(q.criteria!)
      const [choice, p] = choices[id] ?? [keys[0]!, 0.9]
      out[id] = { choice, probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? p : (1 - p) / (keys.length - 1)])) }
    }
  }
  return out
}

describe('the questions and the decision', () => {
  it('asks exactly what jev-photolab measured (facets/questions.mjs at 2e27e29)', () => {
    // Changing a word changes what Jev answers: measure it again there (npm run facets:holdout), then update this.
    expect(createHash('sha256').update(JSON.stringify(FACETS)).digest('hex')).toBe('cce34081ee10343f5022784624021acf6c337ad967064d06cfc3cd06ee67dcda')
  })

  it('makes tags of sure answers, counts people only when sure there are some, and implies animals from birds', () => {
    const r = decide(answers({ person: 0.95, bird: 0.9, water: 0.5 }, { people_count: ['two_to_five', 0.8], setting: ['outdoors', 0.9] }) as never)
    expect(r.tags).toEqual(['person', 'animal', 'bird'])
    expect(r.unsure).toEqual(['water'])
    expect(r.people).toBe('two_to_five')
    expect(r.setting).toBe('outdoors')
    expect(decide(answers({ person: 0.1 }, { people_count: ['one', 0.9] }) as never).people).toBe('none')
    expect(decide(answers({ person: 0.5 }) as never).people).toBeNull()
  })

  it('files a person whose count is unsure under "some", so "With people" still finds them', () => {
    const r = decide(answers({ person: 0.9 }, { people_count: ['six_or_more', 0.5] }) as never)
    expect(r.people).toBeNull()
    expect(peopleValue(r)).toBe('some')
  })

  it('lists a missing or malformed answer instead of reading it as "no"', () => {
    const a = answers({ person: 0.9 }) as Record<string, unknown>
    delete a.water
    a.snow = { noul: 3 }
    expect(decide(a as never).missing).toEqual(['water', 'snow'])
  })
})

describe('the TypeSafe call', () => {
  const ask = { state: { image: 'x' }, questions: FACETS, assets: { x: { type: 'image' as const, format: 'jpg' as const, data_base64: 'AAAA' } } }

  it('says images are on, retries a server error, then answers', async () => {
    const seen: RequestInit[] = []
    let n = 0
    const call = typesafe({
      apiKey: 'k',
      pause: async () => {},
      fetch: async (_url, init) => {
        seen.push(init!)
        return ++n === 1 ? new Response('busy', { status: 503 }) : Response.json({ answers: { person: { noul: 1 } } })
      },
    })
    expect((await call(ask)).answers.person!.noul).toBe(1)
    expect(seen).toHaveLength(2)
    expect((seen[0]!.headers as Record<string, string>)['TypeSafe-Danger-Zone-Images']).toBe('true')
    expect(JSON.parse(seen[0]!.body as string)).toMatchObject({ model: 'jev-1.14.0', assets: { x: { data_base64: 'AAAA' } } })
  })

  it('treats a refused image as the image’s fault, and any other 400 as an error', async () => {
    const refusing = (message: string) => typesafe({ apiKey: 'k', pause: async () => {}, fetch: async () => Response.json({ detail: { error_type: 'api_usage_error', message } }, { status: 400 }) })
    await expect(refusing('Invalid image dimensions.')(ask)).rejects.toBeInstanceOf(TypeSafeRefused)
    const other = refusing('Unknown model.')(ask)
    await expect(other).rejects.toThrow('TypeSafe 400')
    await expect(other).rejects.not.toBeInstanceOf(TypeSafeRefused)
  })
})

describe('people in the library', () => {
  /** TypeSafe answers through global fetch; everything else (the local platform) passes through. */
  function fakeTypeSafe(reply: () => Response) {
    const real = globalThis.fetch
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== ENDPOINT) return real(input, init)
      calls.push(JSON.parse(String(init!.body)).model)
      return reply()
    })
    return calls
  }

  async function upload(admin: string, filename: string): Promise<string> {
    const res = await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength, allowDuplicate: true }), cookie: admin })
    const created = (await res.json()) as { uploadId: string }
    const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
    const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
    return ((await done.json()) as { assetId: string }).assetId
  }

  const row = (id: string) =>
    h.env.DB.prepare('SELECT facet_status, facet_attempts, facet_people, facet_tags, facet_error FROM assets WHERE id = ?').bind(id).first<{
      facet_status: string | null
      facet_attempts: number
      facet_people: string | null
      facet_tags: string | null
      facet_error: string | null
    }>()

  it('asks about new photos, files them under People, and filters the library by them', async () => {
    h = await createHarness({ TYPESAFE_API_KEY: 'test-key' })
    const admin = await setUpAdmin(h)
    let reply = answers({ person: 0.97 }, { people_count: ['one', 0.9] })
    const calls = fakeTypeSafe(() => Response.json({ answers: reply, usage: { input_tokens: 3355 } }))
    const withPerson = await upload(admin, 'a.jpg')
    await runSweep(h.env)
    expect((await row(withPerson))!.facet_status).toBe('queued')
    await doWork(h.env, 'facets')
    expect(await row(withPerson)).toMatchObject({ facet_status: 'done', facet_attempts: 1, facet_people: 'one', facet_tags: '["person"]' })

    reply = answers({ person: 0.02 })
    const empty = await upload(admin, 'b.jpg')
    await runSweep(h.env)
    await doWork(h.env, 'facets')
    expect((await row(empty))!.facet_people).toBe('none')
    expect(calls).toEqual(['jev-1.14.0', 'jev-1.14.0'])

    const ids = async (query: string) =>
      ((await (await h.fetch(`/api/assets?${query}`, { cookie: admin })).json()) as { assets: { id: string }[] }).assets.map((a) => a.id)
    expect(await ids('people=yes')).toEqual([withPerson])
    expect(await ids('people=one')).toEqual([withPerson])
    expect(await ids('people=no')).toEqual([empty])
    // Unfiltered counts come from the whole-archive snapshot (rebuilt every 10 minutes); without one they're live.
    await h.env.DB.prepare("DELETE FROM settings WHERE key = 'stats'").run()
    const facets = (await (await h.fetch('/api/assets/facets', { cookie: admin })).json()) as { people: { value: string; count: number }[] }
    expect(facets.people.sort((a, b) => a.value.localeCompare(b.value))).toEqual([{ value: 'none', count: 1 }, { value: 'one', count: 1 }])
    // A saved search keeps it.
    const saved = await h.fetch('/api/saved-searches', { ...json({ name: 'People', query: 'people=yes&nonsense=1' }), cookie: admin })
    expect(((await saved.json()) as { search: { query: string } }).search.query).toContain('people=yes')
  })

  it('puts a failed photo back only after a pause, and gives up after three tries', async () => {
    h = await createHarness({ TYPESAFE_API_KEY: 'test-key' })
    const admin = await setUpAdmin(h)
    fakeTypeSafe(() => new Response('down', { status: 500 }))
    const id = await upload(admin, 'a.jpg')
    await runSweep(h.env)
    await doWork(h.env, 'facets')
    expect(await row(id)).toMatchObject({ facet_status: 'failed', facet_attempts: 1 })
    // Straight away: nothing to put back, so nothing is spent again.
    expect((await facetsSweep(h.env.DB)).requeued).toBe(0)
    let later = Date.now()
    for (let attempt = 2; attempt <= FACET_MAX_ATTEMPTS; attempt++) {
      later += FACET_RETRY_MS + 1000
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(later)
      const swept = await facetsSweep(h.env.DB)
      vi.useRealTimers()
      expect(swept).toEqual({ requeued: 1, nudge: 1 })
      await doWork(h.env, 'facets')
      expect(await row(id)).toMatchObject({ facet_status: 'failed', facet_attempts: attempt })
    }
    expect((await facetsSweep(h.env.DB, later + FACET_RETRY_MS * 2)).requeued).toBe(0)
    // Listed with the reason; the button for photos never asked leaves it, "try the failed ones again" starts afresh.
    const looked = (await (await h.fetch('/api/ai/facets', { cookie: admin })).json()) as { stats: { couldNot: number; failedForGood: number; unasked: number }; problems: { id: string; status: string }[] }
    expect(looked.stats).toMatchObject({ couldNot: 1, failedForGood: 1, unasked: 0 })
    expect(looked.problems).toMatchObject([{ id, status: 'failed' }])
    expect(((await (await h.fetch('/api/ai/facets/queue', { method: 'POST', cookie: admin })).json()) as { queued: number }).queued).toBe(0)
    const queued = await h.fetch('/api/ai/facets/queue', { ...json({ which: 'failed' }), cookie: admin })
    expect(((await queued.json()) as { queued: number }).queued).toBe(1)
    expect(await row(id)).toMatchObject({ facet_status: 'queued', facet_attempts: 0 })
  })

  it('skips an image Jev refuses, and takes back a photo a dead run left running', async () => {
    h = await createHarness({ TYPESAFE_API_KEY: 'test-key' })
    const admin = await setUpAdmin(h)
    fakeTypeSafe(() => Response.json({ detail: { error_type: 'api_usage_error', message: 'Invalid image dimensions.' } }, { status: 400 }))
    const id = await upload(admin, 'a.jpg')
    await runSweep(h.env)
    await doWork(h.env, 'facets')
    expect(await row(id)).toMatchObject({ facet_status: 'skipped', facet_error: 'TypeSafe refused it: Invalid image dimensions.' })

    await h.env.DB.prepare("UPDATE assets SET facet_status = 'running', facet_started_at = ?, facet_attempts = 1 WHERE id = ?").bind(new Date(Date.now() - 3_600_000).toISOString(), id).run()
    expect((await facetsSweep(h.env.DB)).requeued).toBe(1)
    expect((await row(id))!.facet_status).toBe('queued')
  })

  it('costs the sweep one query when there is nothing to do, and asks nothing without the key', async () => {
    h = await createHarness({ TYPESAFE_API_KEY: 'test-key' })
    expect((await h.count(() => facetsSweep(h.env.DB))).roundTrips).toBe(1)
    await h.dispose()

    h = await createHarness()
    const admin = await setUpAdmin(h)
    const calls = fakeTypeSafe(() => Response.json({ answers: answers({}) }))
    const id = await upload(admin, 'a.jpg')
    await runSweep(h.env)
    expect(await doWork(h.env, 'facets')).toBe(0)
    expect((await row(id))!.facet_status).toBeNull()
    expect(calls).toEqual([])
    const res = await h.fetch('/api/ai/facets/queue', { method: 'POST', cookie: admin })
    expect(res.status).toBe(409)
    expect(((await (await h.fetch('/api/ai/facets', { cookie: admin })).json()) as { stats: { available: boolean; unasked: number } }).stats).toMatchObject({ available: false, unasked: 1 })
  })
})

describe('switching it off, and answers set by hand (plans/PLAN-F2-v2.md)', () => {
  function fakeTypeSafe(reply: () => Response) {
    const real = globalThis.fetch
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== ENDPOINT) return real(input, init)
      calls.push(JSON.parse(String(init!.body)).model)
      return reply()
    })
    return calls
  }

  async function upload(admin: string, filename: string): Promise<string> {
    const res = await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength, allowDuplicate: true }), cookie: admin })
    const created = (await res.json()) as { uploadId: string }
    const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
    const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
    return ((await done.json()) as { assetId: string }).assetId
  }

  const row = (id: string) =>
    h.env.DB.prepare('SELECT facet_status, facet_people, facet_people_jev, facet_people_by FROM assets WHERE id = ?').bind(id).first<{
      facet_status: string | null
      facet_people: string | null
      facet_people_jev: string | null
      facet_people_by: string | null
    }>()
  const setPeople = (admin: string, ids: string[], people: string) => h.fetch('/api/assets/bulk', { ...json({ ids, action: 'people', people }), cookie: admin })
  const settings = (admin: string, patch: Record<string, boolean>) => h.fetch('/api/ai/settings', { method: 'PUT', body: JSON.stringify(patch), headers: { 'Content-Type': 'application/json' }, cookie: admin })

  it('switched off, sends nothing: new photos wait, the queue and the sweep stop, the button says why', async () => {
    h = await createHarness({ TYPESAFE_API_KEY: 'test-key' })
    const admin = await setUpAdmin(h)
    const calls = fakeTypeSafe(() => Response.json({ answers: answers({ person: 0.97 }, { people_count: ['one', 0.9] }) }))
    expect((await settings(admin, { peopleAuto: false })).status).toBe(200)
    const manual = await upload(admin, 'a.jpg')
    await runSweep(h.env)
    // "New photos as they arrive" off: left for the button.
    expect((await row(manual))!.facet_status).toBeNull()

    expect((await settings(admin, { people: false })).status).toBe(200)
    const res = await h.fetch('/api/ai/facets/queue', { method: 'POST', cookie: admin })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('facets_off')
    // Queued before it was switched off: paused, not asked.
    await h.env.DB.prepare("UPDATE assets SET facet_status = 'queued' WHERE id = ?").bind(manual).run()
    expect(await doWork(h.env, 'facets')).toBe(0)
    expect(await facetsSweep(h.env.DB)).toEqual({ requeued: 0, nudge: 0 })
    expect(calls).toEqual([])
    const stats = ((await (await h.fetch('/api/ai/facets', { cookie: admin })).json()) as { stats: { on: boolean; auto: boolean; waiting: number } }).stats
    expect(stats).toMatchObject({ on: false, auto: false, waiting: 1 })

    expect((await settings(admin, { people: true })).status).toBe(200)
    expect(await doWork(h.env, 'facets')).toBe(1)
    expect(calls).toHaveLength(1)
  })

  it('keeps an answer set by hand: Jev never overwrites it, and going back to Jev needs no call', async () => {
    h = await createHarness({ TYPESAFE_API_KEY: 'test-key' })
    const admin = await setUpAdmin(h)
    let reply = answers({ person: 0.97 }, { people_count: ['two_to_five', 0.9] })
    const calls = fakeTypeSafe(() => Response.json({ answers: reply }))
    const a = await upload(admin, 'a.jpg')
    const b = await upload(admin, 'b.jpg')
    await runSweep(h.env)
    // Corrected while queued: done at once (not left queued for ever), and Jev isn't asked.
    expect((await setPeople(admin, [a], 'none')).status).toBe(200)
    expect(await row(a)).toMatchObject({ facet_status: 'done', facet_people: 'none', facet_people_jev: null })
    expect((await row(a))!.facet_people_by).not.toBeNull()
    // Corrected while Jev is looking: Jev's answer goes beside it.
    await h.env.DB.prepare("UPDATE assets SET facet_status = 'running', facet_attempts = 1 WHERE id = ?").bind(b).run()
    await setPeople(admin, [b], 'six_or_more')
    expect(await facetAsset(h.env, b)).toBe('done')
    expect(await row(b)).toMatchObject({ facet_status: 'done', facet_people: 'six_or_more', facet_people_jev: 'two_to_five' })
    expect(calls).toHaveLength(1)
    // The queue, the button and the sweep leave hand answers alone.
    expect(await doWork(h.env, 'facets')).toBe(0)
    expect(((await (await h.fetch('/api/ai/facets/queue', { method: 'POST', cookie: admin })).json()) as { queued: number }).queued).toBe(0)
    expect(await facetsSweep(h.env.DB)).toEqual({ requeued: 0, nudge: 0 })
    expect(((await (await h.fetch('/api/assets?people=six_or_more', { cookie: admin })).json()) as { assets: { id: string }[] }).assets.map((x) => x.id)).toEqual([b])
    const page = (await (await h.fetch(`/api/assets/${b}`, { cookie: admin })).json()) as { people: unknown }
    expect(page.people).toEqual({ value: 'six_or_more', jev: 'two_to_five', byHand: true, status: 'done', error: null })

    // Back to Jev: b has an answer (no call); a never got one, so it's asked.
    reply = answers({ person: 0.9 }, { people_count: ['six_or_more', 0.5] })
    expect((await setPeople(admin, [a, b], 'jev')).status).toBe(200)
    expect(await row(b)).toMatchObject({ facet_people: 'two_to_five', facet_people_by: null })
    expect((await row(a))!.facet_status).toBe('queued')
    await doWork(h.env, 'facets')
    expect(await row(a)).toMatchObject({ facet_status: 'done', facet_people: 'some', facet_people_jev: 'some' })
    expect(calls).toHaveLength(2)
    expect((await setPeople(admin, [a], 'some')).status).toBe(400)
  })

  it('doesn’t ask again about a photo that is processed again', async () => {
    h = await createHarness({ TYPESAFE_API_KEY: 'test-key' })
    const admin = await setUpAdmin(h)
    const calls = fakeTypeSafe(() => Response.json({ answers: answers({ person: 0.02 }) }))
    const id = await upload(admin, 'a.jpg')
    await runSweep(h.env)
    await doWork(h.env, 'facets')
    expect(calls).toHaveLength(1)
    expect((await h.fetch(`/api/assets/${id}/reprocess`, { method: 'POST', cookie: admin })).ok).toBe(true)
    await doWork(h.env, 'process')
    await runSweep(h.env)
    expect(await row(id)).toMatchObject({ facet_status: 'done', facet_people: 'none' })
    expect(await doWork(h.env, 'facets')).toBe(0)
    expect(calls).toHaveLength(1)
  })
})

describe('the whole-archive snapshot', () => {
  it('finishes a build begun before People existed, instead of failing every minute', async () => {
    h = await createHarness()
    const admin = await setUpAdmin(h)
    await h.fetch('/api/uploads', { ...json({ filename: 'a.jpg', size: 1, allowDuplicate: true }), cookie: admin })
    await h.env.DB.prepare("DELETE FROM settings WHERE key IN ('stats', 'stats.build')").run()
    // Start a build, then take People out of what it has so far, as a build saved by the previous version would be.
    let steps = 0
    await statsStep(h.env, () => steps++ < 1, 1)
    const saved = await h.env.DB.prepare("SELECT value FROM settings WHERE key = 'stats.build'").first<{ value: string }>()
    expect(saved).not.toBeNull()
    const build = JSON.parse(saved!.value)
    delete build.partial.facets.people
    await h.env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'stats.build'").bind(JSON.stringify(build)).run()
    expect(await statsStep(h.env, () => true)).toBe(true)
  })
})
