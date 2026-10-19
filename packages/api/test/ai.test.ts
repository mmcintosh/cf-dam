import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { runSweep } from '../src/catalog/sweeper'
import { extractJson, normalizeResult } from '../src/catalog/vision'
import { cookiesFrom, createHarness, json, setUpAdmin, signIn, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))

const REPLY = {
  tags: ['Lighthouse', 'coast', 'storm', 'coast', 'x'],
  alt: 'A red lighthouse on a rocky point under storm clouds',
  caption: 'Storm light over the lighthouse at dusk.',
  description: 'A red and white lighthouse on dark rocks, waves breaking, heavy grey clouds, low warm light.',
  people: 0,
  quality: 'Good',
  text: 'BRYGGEN FISKETORGET',
}

interface Call {
  model: string
  input: Record<string, unknown>
}

/** A stand-in for the Workers AI binding: records calls and answers like Mistral (OpenAI-style). */
function fakeAi(reply: (call: Call) => unknown = () => ({ choices: [{ message: { content: `Sure!\n\`\`\`json\n${JSON.stringify(REPLY)}\n\`\`\`` } }], usage: { prompt_tokens: 900, completion_tokens: 120, neurons: 40 } })) {
  const calls: Call[] = []
  // A class with a private field, like the real binding, so an unbound run() fails here too.
  class FakeAi {
    #calls = calls
    async run(model: string, input: Record<string, unknown>) {
      const call = { model, input }
      this.#calls.push(call)
      return reply(call)
    }
  }
  return { ai: new FakeAi() as unknown as Ai, calls }
}

let h: Harness
afterEach(async () => h?.dispose())

async function upload(admin: string, filename = 'IMG_0001.jpg'): Promise<string> {
  const res = await h.fetch('/api/uploads', { ...json({ filename, size: camera.byteLength, allowDuplicate: true }), cookie: admin })
  const created = (await res.json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${created.uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${created.uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

const asset = async (admin: string, id: string) =>
  (await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as {
    alt: string | null
    caption: string | null
    tags: { name: string; source: string }[]
    ai: { status: string | null; alt: string | null; caption: string | null; description: string | null; quality: string | null; text: string | null; error: string | null }
  }

describe('model replies', () => {
  it('finds JSON in prose or fences and cleans it up', () => {
    const parsed = normalizeResult(extractJson(`Here you go:\n\`\`\`json\n${JSON.stringify(REPLY)}\n\`\`\``))
    expect(parsed.tags).toEqual(['lighthouse', 'coast', 'storm'])
    expect(parsed.quality).toBe('good')
    expect(() => extractJson('no json here')).toThrow()
  })
})

describe('AI review', () => {
  it('queues new uploads, and the sweep analyses them without touching what people wrote', async () => {
    const { ai, calls } = fakeAi()
    h = await createHarness({ AI: ai })
    const admin = await setUpAdmin(h)
    await h.fetch('/api/ai/settings', { method: 'PUT', body: JSON.stringify({ context: 'Coastal landscape photographer' }), cookie: admin })
    const id = await upload(admin)
    await h.fetch(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify({ alt: 'My own alt text', tags: ['norway'] }), cookie: admin })
    expect((await asset(admin, id)).ai.status).toBe('queued')

    const sweep = await runSweep(h.env)
    expect(sweep.analysed).toBe(1)
    expect(calls).toHaveLength(1)
    const content = (calls[0]!.input.messages as { content: { type: string; text?: string; image_url?: { url: string } }[] }[])[0]!.content
    expect(content.find((p) => p.type === 'image_url')!.image_url!.url).toMatch(/^data:image\/jpeg;base64,/)
    const prompt = content.find((p) => p.type === 'text')!.text!
    expect(prompt).toContain('Coastal landscape photographer')
    expect(prompt).toContain('norway')

    const after = await asset(admin, id)
    expect(after.ai).toMatchObject({ status: 'done', alt: REPLY.alt, caption: REPLY.caption, quality: 'good' })
    expect(after.alt).toBe('My own alt text')
    expect(after.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'norway', source: 'user' }),
        expect.objectContaining({ name: 'lighthouse', source: 'ai' }),
        expect.objectContaining({ name: 'storm', source: 'ai' }),
      ]),
    )

    // Describe-it search reaches the model's description.
    const found = (await (await h.fetch('/api/assets?q=waves%20breaking', { cookie: admin })).json()) as { total: number }
    expect(found.total).toBe(1)
    // Text in the picture is searchable too (OCR in the same call).
    expect(after.ai.text).toBe('BRYGGEN FISKETORGET')
    expect(((await (await h.fetch('/api/assets?q=fisketorget', { cookie: admin })).json()) as { total: number }).total).toBe(1)

    const stats = (await (await h.fetch('/api/ai', { cookie: admin })).json()) as { available: boolean; stats: { analysed: number; averageNeurons: number; usdPerPhoto: number } }
    expect(stats.available).toBe(true)
    expect(stats.stats).toMatchObject({ analysed: 1, averageNeurons: 40 })
    expect(stats.stats.usdPerPhoto).toBeCloseTo(0.00044)
  })

  it('accepts suggestions into empty fields, keeps AI tags through tag edits, and removes one', async () => {
    const { ai } = fakeAi()
    h = await createHarness({ AI: ai })
    const admin = await setUpAdmin(h)
    const id = await upload(admin)
    expect((await (await h.fetch(`/api/assets/${id}/ai/analyze`, { method: 'POST', cookie: admin })).json()) as { outcome: string }).toMatchObject({ outcome: 'done' })

    // Editing the person's own tags leaves AI suggestions alone; naming one adopts it.
    await h.fetch(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify({ tags: ['Coast', 'mine'] }), cookie: admin })
    let tags = (await asset(admin, id)).tags
    expect(tags.find((t) => t.name.toLowerCase() === 'coast')?.source).toBe('user')
    expect(tags.find((t) => t.name === 'lighthouse')?.source).toBe('ai')

    await h.fetch(`/api/assets/${id}/ai/tags/storm`, { method: 'DELETE', cookie: admin })
    const accepted = (await (await h.fetch(`/api/assets/${id}/ai/accept`, { ...json({ fields: ['alt', 'tags'] }), cookie: admin })).json()) as { alt: string; caption: string | null; tags: { name: string; source: string }[] }
    expect(accepted.alt).toBe(REPLY.alt)
    expect(accepted.caption).toBeNull()
    expect(accepted.tags.every((t) => t.source === 'user')).toBe(true)
    expect(accepted.tags.map((t) => t.name)).not.toContain('storm')

    // Accepting again doesn't overwrite what is now there, unless asked.
    await h.fetch(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify({ alt: 'Edited by hand' }), cookie: admin })
    await h.fetch(`/api/assets/${id}/ai/accept`, { ...json({ fields: ['alt'] }), cookie: admin })
    expect((await asset(admin, id)).alt).toBe('Edited by hand')
    await h.fetch(`/api/assets/${id}/ai/accept`, { ...json({ fields: ['alt'], overwrite: true }), cookie: admin })
    expect((await asset(admin, id)).alt).toBe(REPLY.alt)
  })

  it('records failures, and backfill and bulk queue them again', async () => {
    let fail = true
    const { ai } = fakeAi(() => (fail ? { response: 'I cannot help with that.' } : { response: REPLY, usage: { neurons: 30 } }))
    h = await createHarness({ AI: ai })
    const admin = await setUpAdmin(h)
    const a = await upload(admin, 'a.jpg')
    const b = await upload(admin, 'b.jpg')
    await runSweep(h.env)
    expect((await asset(admin, a)).ai).toMatchObject({ status: 'failed', error: 'The model did not return JSON.' })

    fail = false
    const bulk = await h.fetch('/api/assets/bulk', { ...json({ ids: [a], action: 'ai-queue' }), cookie: admin })
    expect(await bulk.json()).toEqual({ changed: 1 })
    const backfill = (await (await h.fetch('/api/ai/backfill', { method: 'POST', cookie: admin })).json()) as { queued: number }
    expect(backfill.queued).toBe(1) // b; a is already queued
    // Switched off, nothing would analyse them: queueing is refused rather than left waiting.
    await h.fetch('/api/ai/settings', { method: 'PUT', body: JSON.stringify({ enabled: false }), cookie: admin })
    expect((await h.fetch('/api/assets/bulk', { ...json({ ids: [a], action: 'ai-queue' }), cookie: admin })).status).toBe(409)
    const off = await h.fetch('/api/ai/backfill', { method: 'POST', cookie: admin })
    expect(off.status).toBe(409)
    expect(await off.json()).toMatchObject({ error: 'ai_off' })
    await h.fetch('/api/ai/settings', { method: 'PUT', body: JSON.stringify({ enabled: true }), cookie: admin })
    await runSweep(h.env)
    expect((await asset(admin, a)).ai.status).toBe('done')
    expect((await asset(admin, b)).ai.status).toBe('done')

    const accept = await h.fetch('/api/assets/bulk', { ...json({ ids: [a, b], action: 'ai-accept', fields: ['caption'] }), cookie: admin })
    expect(await accept.json()).toEqual({ changed: 2 })
    expect((await asset(admin, b)).caption).toBe(REPLY.caption)
  })

  it('does nothing without the binding, or when switched off, and checks permissions', async () => {
    h = await createHarness()
    const admin = await setUpAdmin(h)
    const id = await upload(admin)
    expect((await asset(admin, id)).ai.status).toBeNull()
    expect((await h.fetch(`/api/assets/${id}/ai/analyze`, { method: 'POST', cookie: admin })).status).toBe(409)
    expect((await h.fetch('/api/ai/settings', { method: 'PUT', body: JSON.stringify({ model: '@cf/nope' }), cookie: admin })).status).toBe(400)

    await h.fetch('/api/users', { ...json({ name: 'V', email: 'v@example.com', password: 'viewer password 1', roles: ['viewer'] }), cookie: admin })
    await h.fetch('/api/users', { ...json({ name: 'E', email: 'e@example.com', password: 'editor password 1', roles: ['editor'] }), cookie: admin })
    const viewer = cookiesFrom(await signIn(h, 'v@example.com', 'viewer password 1'))
    const editor = cookiesFrom(await signIn(h, 'e@example.com', 'editor password 1'))
    expect((await h.fetch('/api/ai', { cookie: viewer })).status).toBe(403)
    expect((await h.fetch('/api/assets/bulk', { ...json({ ids: [id], action: 'ai-queue' }), cookie: viewer })).status).toBe(403)
    expect((await h.fetch('/api/ai', { cookie: editor })).status).toBe(200)
    expect((await h.fetch('/api/ai/settings', { method: 'PUT', body: JSON.stringify({ auto: false }), cookie: editor })).status).toBe(403)
  })

  it('leaves new uploads alone when automatic review is off', async () => {
    const { ai, calls } = fakeAi()
    h = await createHarness({ AI: ai })
    const admin = await setUpAdmin(h)
    await h.fetch('/api/ai/settings', { method: 'PUT', body: JSON.stringify({ auto: false }), cookie: admin })
    const id = await upload(admin)
    await runSweep(h.env)
    expect((await asset(admin, id)).ai.status).toBeNull()
    expect(calls).toHaveLength(0)
  })
})
