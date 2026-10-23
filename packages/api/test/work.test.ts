/**
 * The fast lane for background work (catalog/work.ts): messages that say "work is waiting", chains
 * that carry on while it is, and the sweep still there for whatever a message doesn't reach.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { CLAIM, doWork, handleWork, MAX_CHAINS, nudge, type WorkMessage } from '../src/catalog/work'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))
const REPLY = { tags: ['coast'], alt: 'A coast', caption: 'Coast.', description: 'Rocks and sea.', people: 0, quality: 'good', text: '' }

let h: Harness
afterEach(async () => h?.dispose())

/** A stand-in queue: what was sent, and optionally a send that fails (the day's operations used up). */
function fakeQueue(failing = false) {
  const sent: WorkMessage[] = []
  const queue = {
    async send(body: WorkMessage) {
      if (failing) throw new Error('Queue operations limit reached')
      sent.push(body)
    },
    async sendBatch(messages: { body: WorkMessage }[]) {
      if (failing) throw new Error('Queue operations limit reached')
      sent.push(...messages.map((m) => m.body))
    },
  } as unknown as Queue<WorkMessage>
  return { queue, sent }
}

function fakeAi() {
  let calls = 0
  const ai = {
    async run() {
      calls++
      return { choices: [{ message: { content: JSON.stringify(REPLY) } }] }
    },
  } as unknown as Ai
  return { ai, calls: () => calls }
}

async function upload(admin: string): Promise<string> {
  const res = await h.fetch('/api/uploads', { ...json({ filename: 'IMG_1.jpg', size: camera.byteLength, allowDuplicate: true }), cookie: admin })
  const { uploadId } = (await res.json()) as { uploadId: string }
  const put = await h.fetch(`/api/uploads/${uploadId}/parts/1`, { method: 'PUT', body: camera, headers: { 'Content-Type': 'application/octet-stream' }, cookie: admin })
  const done = await h.fetch(`/api/uploads/${uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  return ((await done.json()) as { assetId: string }).assetId
}

const aiCounts = async () =>
  (await h.env.DB.prepare("SELECT SUM(ai_status = 'queued') AS queued, SUM(ai_status = 'done') AS done FROM assets").first<{ queued: number; done: number }>())!

function batchOf(bodies: unknown[]) {
  const acked: number[] = []
  const batch = {
    queue: 'cf-dam-work',
    messages: bodies.map((body, i) => ({ id: String(i), timestamp: new Date(), attempts: 1, body, ack: () => acked.push(i), retry: () => {} })),
    ackAll: () => {},
    retryAll: () => {},
  } as unknown as MessageBatch<WorkMessage>
  return { batch, acked }
}

describe('the fast lane', () => {
  it('starts a chain per handful of waiting photos, a few at most, and leaves the rest to the sweep when it can’t send', async () => {
    const { queue, sent } = fakeQueue()
    h = await createHarness({ WORK: queue })
    await nudge(h.env, 'ai', 1)
    await nudge(h.env, 'ai', CLAIM.ai * 2)
    await nudge(h.env, 'ai', 10_000)
    await nudge(h.env, 'process', 0)
    expect(sent.length).toBe(1 + 2 + MAX_CHAINS)
    expect(sent.every((m) => m.kind === 'ai')).toBe(true)

    // No binding, or no operations left: nothing breaks.
    await nudge({ ...h.env, WORK: undefined }, 'ai', 5)
    const failing = fakeQueue(true)
    await expect(nudge({ ...h.env, WORK: failing.queue }, 'ai', 5)).resolves.toBeUndefined()
  })

  it('reviews queued photos a handful at a time, carrying on while more wait, and sends new uploads to it', async () => {
    const { queue, sent } = fakeQueue()
    const { ai, calls } = fakeAi()
    h = await createHarness({ WORK: queue, AI: ai })
    const admin = await setUpAdmin(h)
    // Uploads queue their AI review and say so.
    for (let i = 0; i < CLAIM.ai + 2; i++) await upload(admin)
    expect((await aiCounts()).queued).toBe(CLAIM.ai + 2)
    expect(sent.filter((m) => m.kind === 'ai').length).toBe(CLAIM.ai + 2)
    sent.length = 0

    // A full hand: the chain carries on.
    expect(await doWork(h.env, 'ai')).toBe(CLAIM.ai)
    expect(sent).toEqual([{ kind: 'ai' }])
    // The rest, and the chain ends.
    expect(await doWork(h.env, 'ai')).toBe(2)
    expect(sent).toEqual([{ kind: 'ai' }])
    // Nothing left to claim: a stray message does nothing.
    expect(await doWork(h.env, 'ai')).toBe(0)
    expect(await aiCounts()).toMatchObject({ queued: 0, done: CLAIM.ai + 2 })
    expect(calls()).toBe(CLAIM.ai + 2)
  })

  it('never reviews a photo the sweep has claimed, and acknowledges every message, even one whose work failed', async () => {
    const { queue } = fakeQueue()
    const { ai, calls } = fakeAi()
    h = await createHarness({ WORK: queue, AI: ai })
    const admin = await setUpAdmin(h)
    const id = await upload(admin)
    await h.env.DB.prepare("UPDATE assets SET ai_status = 'running' WHERE id = ?").bind(id).run()
    expect(await doWork(h.env, 'ai')).toBe(0)
    expect(calls()).toBe(0)

    await h.env.DB.prepare("UPDATE assets SET ai_status = 'queued' WHERE id = ?").bind(id).run()
    const broken = { ...h.env, DB: { prepare: () => { throw new Error('D1 is down') } } as unknown as D1Database }
    const { batch, acked } = batchOf([{ kind: 'ai' }, { kind: 'nonsense' }, null])
    await handleWork(broken, batch)
    expect(acked).toEqual([0, 1, 2])
    // The photo still waits for whoever comes next.
    expect((await aiCounts()).queued).toBe(1)
  })

  it('queues AI review asked for by hand or for the whole archive', async () => {
    const { queue, sent } = fakeQueue()
    const { ai } = fakeAi()
    h = await createHarness({ WORK: queue, AI: ai })
    const admin = await setUpAdmin(h)
    const ids = [await upload(admin), await upload(admin)]
    await h.env.DB.prepare('UPDATE assets SET ai_status = NULL').run()
    sent.length = 0
    expect((await h.fetch('/api/ai/backfill', { method: 'POST', cookie: admin })).status).toBe(200)
    expect(sent).toEqual([{ kind: 'ai' }])
    await h.env.DB.prepare('UPDATE assets SET ai_status = NULL').run()
    sent.length = 0
    expect((await h.fetch('/api/assets/bulk', { ...json({ ids, action: 'ai-queue' }), cookie: admin })).status).toBe(200)
    expect(sent).toEqual([{ kind: 'ai' }])
  })
})
