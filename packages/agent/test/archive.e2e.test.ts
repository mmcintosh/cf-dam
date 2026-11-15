/**
 * Archiving, end to end: the real agent and the real API (in-process), sending originals to a real
 * S3-compatible server. Runs when S3_TEST_ENDPOINT is set (as in CI), like the API's S3 tests.
 */
import { createHash } from 'node:crypto'
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AwsClient } from 'aws4fetch'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, json, setUpAdmin, type Harness } from '../../api/test/harness.ts'
import { Api } from '../src/api.ts'
import { inWindow } from '../src/archive.ts'
import { Agent } from '../src/main.ts'

const s3Endpoint = process.env.S3_TEST_ENDPOINT
const s3Credentials = { accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? '' }
const PART = 5 * 1024 * 1024
const BASE = 'http://localhost'
const placesGz = readFileSync(new URL('../../../public/places/cities1000.tsv.gz', import.meta.url))
const ASSETS = { fetch: async () => new Response(placesGz) } as unknown as Fetcher

describe('the archive hours', () => {
  const at = (hour: number) => new Date(2026, 9, 20, hour, 30)
  it('cross midnight, or cover the whole day when from and to are equal', () => {
    const night = { fromHour: 22, toHour: 7, maxMbps: 0 }
    expect([21, 22, 23, 0, 6, 7].map((h) => inWindow(night, at(h)))).toEqual([false, true, true, true, true, false])
    const day = { fromHour: 9, toHour: 17, maxMbps: 0 }
    expect([8, 9, 16, 17].map((h) => inWindow(day, at(h)))).toEqual([false, true, true, false])
    expect(inWindow({ fromHour: 0, toHour: 0, maxMbps: 0 }, at(13))).toBe(true)
  })
})

describe.skipIf(!s3Endpoint)('archiving, end to end (against a real S3-compatible server)', () => {
  let h: Harness
  let admin: string
  let photos: string
  let data: string
  let bucket: string
  const calls: string[] = []
  /** Stands in for cf-dam's answer to a call, when it returns one (tests put faults here). */
  let cfDam: ((path: string, init?: RequestInit) => Promise<Response | undefined>) | null = null
  const client = new AwsClient({ ...s3Credentials, service: 's3', region: 'us-east-1' })

  beforeEach(async () => {
    h = await createHarness({ ASSETS, ARCHIVE_PART_BYTES: String(PART) })
    admin = await setUpAdmin(h)
    photos = mkdtempSync(join(tmpdir(), 'nas-photos-'))
    data = mkdtempSync(join(tmpdir(), 'nas-data-'))
    calls.length = 0
    cfDam = null
    bucket = `cfdam-agent-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`
    expect((await client.fetch(`${s3Endpoint}/${bucket}`, { method: 'PUT' })).ok).toBe(true)
  })
  afterEach(async () => {
    await h.dispose()
    rmSync(photos, { recursive: true, force: true })
    rmSync(data, { recursive: true, force: true })
  })

  function newAgent(): Agent {
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const path = url.slice(BASE.length)
      calls.push(`${init?.method ?? 'GET'} ${path}`)
      const faked = cfDam ? await cfDam(path, init) : undefined
      return faked ?? h.fetch(path, init as RequestInit & { cookie?: string })
    }
    return new Agent({ url: BASE, dataDir: data, photosDir: photos, port: 0, host: '127.0.0.1', workers: 2, name: 'Studio Mac', extraFolders: [] }, new Api(BASE, null, fetchImpl, 1), async () => [])
  }

  /** A photo, left alone for two days (only files that have settled are archived). */
  async function photo(rel: string, seed: number, big = false) {
    const path = join(photos, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    const image = big
      ? sharp({ create: { width: 3200, height: 2400, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 70 } } })
      : sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: (seed * 53) % 256, g: (seed * 97) % 256, b: 90 } } })
    await image.jpeg({ quality: 100 }).toFile(path)
    settle(path)
  }
  const settle = (path: string) => {
    const old = new Date(Date.now() - 2 * 86_400_000)
    utimesSync(path, old, old)
  }

  async function setUp(): Promise<{ agent: Agent; sourceId: string; connectionId: string }> {
    const connection = await h.fetch('/api/connections', {
      ...json({ name: 'Glacier', endpoint: s3Endpoint, region: 'us-east-1', bucket, forcePathStyle: true, ...s3Credentials }),
      cookie: admin,
    })
    const connectionId = ((await connection.json()) as { connection: { id: string } }).connection.id
    const agent = newAgent()
    const pairing = agent.pair()
    while (!agent.status().pairingCode) await new Promise((r) => setTimeout(r, 20))
    const paired = await h.fetch('/api/sources/pair', { ...json({ code: agent.status().pairingCode }), cookie: admin })
    const sourceId = ((await paired.json()) as { source: { id: string } }).source.id
    await pairing
    await agent.reportFolders()
    await h.fetch(`/api/sources/${sourceId}/roots`, { ...json({ path: photos }), cookie: admin })
    // All day (from = to), no speed limit; the test server has no Deep Archive class.
    const patched = await h.fetch(`/api/sources/${sourceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ archive: { connectionId, storageClass: 'STANDARD', fromHour: 0, toHour: 0 } }),
      cookie: admin,
    })
    expect(patched.status).toBe(200)
    return { agent, sourceId, connectionId }
  }

  const archived = async (connectionId: string) =>
    (await h.env.DB.prepare('SELECT l.asset_id, l.key, a.filename, a.sha256 FROM asset_locations l JOIN assets a ON a.id = l.asset_id WHERE l.connection_id = ?').bind(connectionId).all<{
      asset_id: string
      key: string
      filename: string
      sha256: string
    }>()).results

  const objectSha = async (key: string) => {
    const res = await client.fetch(`${s3Endpoint}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`)
    return createHash('sha256').update(new Uint8Array(await res.arrayBuffer())).digest('hex')
  }
  const fileSha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

  it('archives every settled original, in checksummed parts, byte for byte', async () => {
    await photo('2019/DSC_0001.jpg', 1)
    await photo('2019/DSC_0002.jpg', 2)
    await photo('2020/DSC_0003.jpg', 3, true)
    // Too fresh: archived only once it has been left alone for a day.
    mkdirSync(join(photos, '2026'))
    await sharp({ create: { width: 800, height: 600, channels: 3, background: '#345' } }).jpeg().toFile(join(photos, '2026', 'new.jpg'))
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    await agent.archiveAll()

    const copies = await archived(connectionId)
    expect(copies.map((c) => c.filename).sort()).toEqual(['DSC_0001.jpg', 'DSC_0002.jpg', 'DSC_0003.jpg'])
    for (const copy of copies) {
      const original = join(photos, copy.filename === 'DSC_0003.jpg' ? '2020' : '2019', copy.filename)
      expect(copy.sha256).toBe(fileSha(original))
      expect(await objectSha(copy.key)).toBe(copy.sha256)
    }
    // The big one went in parts.
    expect(calls.filter((c) => c === 'POST /api/agent/archive/part').length).toBeGreaterThanOrEqual(5)
    expect((await readdir(join(photos, '2026'))).length).toBe(1)

    // Nothing left: a second pass asks nothing of cf-dam.
    calls.length = 0
    await agent.archiveAll()
    expect(calls.filter((c) => c.includes('/archive/'))).toEqual([])
  }, 180_000)

  it('carries on from the next part after being stopped mid-file', async () => {
    await photo('2020/DSC_0003.jpg', 3, true)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    const [asset] = (await h.env.DB.prepare('SELECT id FROM assets').all<{ id: string }>()).results
    // Stopped as soon as the first part is safely in the bucket.
    const stopper = setInterval(() => (agent.state.upload(asset!.id)?.parts.length ?? 0) >= 1 && agent.stop(), 5)
    await agent.archiveAll()
    clearInterval(stopper)
    expect(await archived(connectionId)).toEqual([])
    const sentFirst = calls.filter((c) => c === 'POST /api/agent/archive/part').length

    calls.length = 0
    const resumed = newAgent()
    await resumed.pair()
    await resumed.scanAll()
    await resumed.archiveAll()
    const copies = await archived(connectionId)
    expect(copies).toHaveLength(1)
    expect(await objectSha(copies[0]!.key)).toBe(fileSha(join(photos, '2020', 'DSC_0003.jpg')))
    // No part sent twice, and the same upload carried on.
    const parts = Math.ceil(readFileSync(join(photos, '2020', 'DSC_0003.jpg')).byteLength / PART)
    expect(sentFirst + calls.filter((c) => c === 'POST /api/agent/archive/part').length).toBe(parts)
    expect(calls.filter((c) => c === 'POST /api/agent/archive/start')).toEqual([])
  }, 180_000)

  it('shares one copy between identical files', async () => {
    await photo('a/DSC_0005.jpg', 5)
    mkdirSync(join(photos, 'b'))
    copyFileSync(join(photos, 'a', 'DSC_0005.jpg'), join(photos, 'b', 'DSC_0005 copy.jpg'))
    settle(join(photos, 'b', 'DSC_0005 copy.jpg'))
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    await agent.archiveAll()
    const copies = await archived(connectionId)
    expect(copies).toHaveLength(2)
    expect(copies[0]!.key).toBe(copies[1]!.key)
    expect(calls.filter((c) => c === 'POST /api/agent/archive/complete')).toHaveLength(1)
    expect(calls.filter((c) => c === 'POST /api/agent/archive/link')).toHaveLength(1)
  }, 180_000)

  // ── When things go wrong (PLAN-HELPER-ARCHIVE-v2 A.9) ──────────────────────

  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const s3Url = (key: string, query = '') => `${s3Endpoint}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}${query}`
  const serverUpload = async () => (await h.env.DB.prepare('SELECT key, multipart_id FROM archive_uploads').first<{ key: string; multipart_id: string }>())!
  /** The bucket ends the upload under way, as its lifecycle rule does. */
  const endAtBucket = async () => {
    const u = await serverUpload()
    expect((await client.fetch(s3Url(u.key, `?uploadId=${encodeURIComponent(u.multipart_id)}`), { method: 'DELETE' })).ok).toBe(true)
  }
  const fileState = (agent: Agent, rel: string) => agent.state.archiveError(agent.state.archiveCandidates(null, Date.now(), 100).find((f) => f.path === rel)?.root_id ?? rootOf(agent), rel)
  const rootOf = (agent: Agent) => (agent as unknown as { lastConfig: { roots: { id: string }[] } }).lastConfig.roots[0]!.id
  const progressOf = (agent: Agent) => (agent as unknown as { archiveProgress: { bucket: { refusing: string | null }; lastError: string | null } }).archiveProgress
  /** The parts' PUTs to the bucket, with a fault in the way while `fault` answers. */
  const faultyBucket = (agent: Agent, fault: (n: number) => Response | undefined) => {
    let n = 0
    agent.archiveFetch = async (url, init) => fault(++n) ?? fetch(url, init)
  }
  const s3Error = (status: number, code: string, msg = '') => new Response(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>${msg}</Message></Error>`, { status })

  it('starts again at once when cf-dam has forgotten an upload the helper was part-way through, without counting a try', async () => {
    await photo('2020/DSC_0003.jpg', 3, true)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    const [asset] = (await h.env.DB.prepare('SELECT id FROM assets').all<{ id: string }>()).results
    const stopper = setInterval(() => (agent.state.upload(asset!.id)?.parts.length ?? 0) >= 1 && agent.stop(), 5)
    await agent.archiveAll()
    clearInterval(stopper)
    // Swept, or a catalogue restored from before it began.
    await h.env.DB.prepare('DELETE FROM archive_uploads').run()
    calls.length = 0
    const resumed = newAgent()
    await resumed.pair()
    await resumed.scanAll()
    await resumed.archiveAll()
    expect(await archived(connectionId)).toHaveLength(1)
    expect(calls.filter((c) => c === 'POST /api/agent/archive/start')).toHaveLength(1)
    expect(fileState(resumed, '2020/DSC_0003.jpg')).toMatchObject({ attempts: 0, restarts: 0 })
  }, 180_000)

  it('records the copy when an earlier complete worked but its answer was lost', async () => {
    await photo('2020/DSC_0003.jpg', 3, true)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    cfDam = async (path, init) => {
      if (path !== '/api/agent/archive/complete') return undefined
      // The bucket completes it; the answer never reaches cf-dam, which is asked again.
      const u = await serverUpload()
      const parts = (JSON.parse(String(init!.body)) as { parts: { partNumber: number; etag: string; checksum: string }[] }).parts
      const xml = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag><ChecksumSHA256>${p.checksum}</ChecksumSHA256></Part>`).join('')}</CompleteMultipartUpload>`
      expect((await client.fetch(s3Url(u.key, `?uploadId=${encodeURIComponent(u.multipart_id)}`), { method: 'POST', body: xml })).ok).toBe(true)
      cfDam = null
      return undefined
    }
    await agent.archiveAll()
    const copies = await archived(connectionId)
    expect(copies).toHaveLength(1)
    expect(await objectSha(copies[0]!.key)).toBe(fileSha(join(photos, '2020', 'DSC_0003.jpg')))
    expect(calls.filter((c) => c === 'POST /api/agent/archive/start')).toHaveLength(1)
  }, 180_000)

  it('starts a file again when the bucket ended its upload, without holding up the next file, and gives it up after three times', async () => {
    await photo('2020/DSC_0003.jpg', 3, true)
    await photo('2021/DSC_0004.jpg', 4)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    // Ended once: started again in the same pass, and archived.
    let ends = 1
    cfDam = async (path) => {
      if (path === '/api/agent/archive/complete' && ends > 0 && (await serverUpload())) {
        ends--
        await endAtBucket()
      }
      return undefined
    }
    await agent.archiveAll()
    expect((await archived(connectionId)).map((c) => c.filename).sort()).toEqual(['DSC_0003.jpg', 'DSC_0004.jpg'])
    expect(calls.filter((c) => c === 'POST /api/agent/archive/start')).toHaveLength(3)
  }, 180_000)

  it('gives a file up, saying why, when the bucket ends every upload of it', async () => {
    await photo('2020/DSC_0003.jpg', 3, true)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    cfDam = async (path) => {
      if (path === '/api/agent/archive/complete') await endAtBucket()
      return undefined
    }
    // Once a pass, a fresh start: three ends over two passes give it up.
    await agent.archiveAll()
    expect(fileState(agent, '2020/DSC_0003.jpg')).toMatchObject({ attempts: 0, restarts: 2 })
    await agent.archiveAll()
    expect(fileState(agent, '2020/DSC_0003.jpg')).toMatchObject({ attempts: 3, restarts: 3 })
    expect(fileState(agent, '2020/DSC_0003.jpg')?.error).toMatch(/lifecycle/)
    expect(await archived(connectionId)).toEqual([])
    calls.length = 0
    await agent.archiveAll()
    expect(calls.filter((c) => c.includes('/archive/'))).toEqual([])
  }, 180_000)

  it('waits out a bucket that is busy or timed out, without starting the upload again', async () => {
    await photo('2020/DSC_0003.jpg', 3, true)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    faultyBucket(agent, (n) => (n === 2 ? s3Error(400, 'RequestTimeout') : n === 4 ? s3Error(429, 'SlowDown') : undefined))
    await agent.archiveAll()
    expect(await archived(connectionId)).toHaveLength(1)
    expect(calls.filter((c) => c === 'POST /api/agent/archive/abort')).toEqual([])
    expect(calls.filter((c) => c === 'POST /api/agent/archive/start')).toHaveLength(1)
  }, 180_000)

  it('signs a part again when its URL has expired, keeping the parts already sent', async () => {
    await photo('2020/DSC_0003.jpg', 3, true)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    faultyBucket(agent, (n) => (n === 2 ? s3Error(400, 'ExpiredToken') : n === 3 ? s3Error(403, 'AccessDenied', 'Request has expired') : undefined))
    await agent.archiveAll()
    expect(await archived(connectionId)).toHaveLength(1)
    const parts = Math.ceil(readFileSync(join(photos, '2020', 'DSC_0003.jpg')).byteLength / PART)
    // Each part signed once, and the one that expired twice more.
    expect(calls.filter((c) => c === 'POST /api/agent/archive/part')).toHaveLength(parts + 2)
    expect(calls.filter((c) => c === 'POST /api/agent/archive/start')).toHaveLength(1)
  }, 180_000)

  it('counts one try when the bucket refuses a part, keeps the upload, and carries on from that part next time', async () => {
    await photo('2020/DSC_0003.jpg', 3, true)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    let refusing = true
    faultyBucket(agent, (n) => (refusing && n >= 2 ? s3Error(403, 'AccessDenied', 'Access Denied') : undefined))
    await agent.archiveAll()
    expect(await archived(connectionId)).toEqual([])
    expect(fileState(agent, '2020/DSC_0003.jpg')).toMatchObject({ attempts: 1 })
    expect(calls.filter((c) => c === 'POST /api/agent/archive/abort')).toEqual([])
    const [asset] = (await h.env.DB.prepare('SELECT id FROM assets').all<{ id: string }>()).results
    expect(agent.state.upload(asset!.id)?.parts).toHaveLength(1)
    refusing = false
    calls.length = 0
    await agent.archiveAll()
    expect(await archived(connectionId)).toHaveLength(1)
    expect(calls.filter((c) => c === 'POST /api/agent/archive/start')).toEqual([])
    expect(fileState(agent, '2020/DSC_0003.jpg')).toMatchObject({ attempts: 0 })
  }, 180_000)

  it('blames a file the bucket denies a part of only when a file after it gets through', async () => {
    await photo('2019/DSC_0001.jpg', 1)
    await photo('2019/DSC_0002.jpg', 2)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    const backoff = (agent as unknown as { bucketBackoff: { until: number; waitMs: number } }).bucketBackoff
    // Every part denied (the bucket's policy changed): the bucket, not the files.
    faultyBucket(agent, () => s3Error(403, 'AccessDenied', 'Access Denied'))
    await agent.archiveAll()
    for (const rel of ['2019/DSC_0001.jpg', '2019/DSC_0002.jpg']) expect(fileState(agent, rel)).toMatchObject({ attempts: 0 })
    expect(progressOf(agent).bucket.refusing).toBe('AccessDenied')
    // Answers about the bucket itself: the bucket at once, on the first part.
    backoff.until = 0
    faultyBucket(agent, () => s3Error(404, 'NoSuchBucket', 'The specified bucket does not exist'))
    await agent.archiveAll()
    expect(progressOf(agent).bucket.refusing).toBe('NoSuchBucket')
    for (const rel of ['2019/DSC_0001.jpg', '2019/DSC_0002.jpg']) expect(fileState(agent, rel)).toMatchObject({ attempts: 0 })
    // Only the first file denied, and the next one goes through: it was that file.
    backoff.until = 0
    faultyBucket(agent, (n) => (n === 1 ? s3Error(403, 'AccessDenied', 'Access Denied') : undefined))
    await agent.archiveAll()
    expect((await archived(connectionId)).map((c) => c.filename)).toEqual(['DSC_0002.jpg'])
    expect(fileState(agent, '2019/DSC_0001.jpg')).toMatchObject({ attempts: 1 })
    expect(progressOf(agent).bucket.refusing).toBeNull()
  }, 180_000)

  it('gives no file up while the bucket refuses everything, and waits longer between tries', async () => {
    await photo('2019/DSC_0001.jpg', 1)
    await photo('2019/DSC_0002.jpg', 2)
    const { agent } = await setUp()
    await agent.scanAll()
    cfDam = async (path) =>
      path === '/api/agent/archive/start' ? answer(502, { error: 'storage', code: 'AccessDenied', scope: 'bucket', message: 'Creating the upload failed: AccessDenied' }) : undefined
    for (let i = 0; i < 5; i++) await agent.archiveAll()
    // One try, then waiting: the other four passes asked nothing.
    expect(calls.filter((c) => c === 'POST /api/agent/archive/start')).toHaveLength(1)
    expect(progressOf(agent).bucket.refusing).toBe('AccessDenied')
    const backoff = (agent as unknown as { bucketBackoff: { until: number; waitMs: number } }).bucketBackoff
    expect(backoff.waitMs).toBe(15 * 60_000)
    // The wait over, refused again: twice as long.
    backoff.until = 0
    await agent.archiveAll()
    expect(backoff.waitMs).toBe(30 * 60_000)
    for (const rel of ['2019/DSC_0001.jpg', '2019/DSC_0002.jpg']) expect(fileState(agent, rel)).toMatchObject({ attempts: 0 })
    // Answering again: archived, and the refusal forgotten.
    cfDam = null
    backoff.until = 0
    await agent.archiveAll()
    expect(progressOf(agent).bucket.refusing).toBeNull()
    expect(backoff.waitMs).toBe(0)
  }, 180_000)

  it('blames a file cf-dam fails on only when the files after it get through', async () => {
    await photo('2019/DSC_0001.jpg', 1)
    await photo('2019/DSC_0002.jpg', 2)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    const bad = (await h.env.DB.prepare("SELECT id FROM assets WHERE filename = 'DSC_0001.jpg'").first<{ id: string }>())!.id
    cfDam = async (path, init) =>
      path === '/api/agent/archive/start' && String(init?.body).includes(bad) ? answer(500, { error: 'internal_error' }) : undefined
    await agent.archiveAll()
    expect((await archived(connectionId)).map((c) => c.filename)).toEqual(['DSC_0002.jpg'])
    expect(fileState(agent, '2019/DSC_0001.jpg')).toMatchObject({ attempts: 1 })
    // Alone in a pass, nothing shows whether cf-dam or the file is at fault: no try.
    await agent.archiveAll()
    expect(fileState(agent, '2019/DSC_0001.jpg')).toMatchObject({ attempts: 1 })
    // With new photos getting through after it, each pass counts one.
    for (const seed of [5, 6]) {
      await photo(`2019/DSC_000${seed}.jpg`, seed)
      await agent.scanAll()
      await agent.archiveAll()
    }
    expect(fileState(agent, '2019/DSC_0001.jpg')).toMatchObject({ attempts: 3 })
    expect(await archived(connectionId)).toHaveLength(3)
  }, 180_000)

  it('stops after two files cf-dam fails on, blaming neither', async () => {
    await photo('2019/DSC_0001.jpg', 1)
    await photo('2019/DSC_0002.jpg', 2)
    await photo('2019/DSC_0003.jpg', 3)
    const { agent } = await setUp()
    await agent.scanAll()
    cfDam = async (path) => (path === '/api/agent/archive/start' ? answer(500, { error: 'internal_error' }) : undefined)
    await agent.archiveAll()
    // Each start is asked twice (one retry), for two files; the third isn't tried.
    expect(calls.filter((c) => c === 'POST /api/agent/archive/start')).toHaveLength(4)
    for (const rel of ['2019/DSC_0001.jpg', '2019/DSC_0002.jpg', '2019/DSC_0003.jpg']) expect(fileState(agent, rel)).toMatchObject({ attempts: 0 })
  }, 180_000)

  it('stops archiving when it is turned off, even part-way through a file', async () => {
    await photo('2020/DSC_0003.jpg', 3, true)
    await photo('2021/DSC_0004.jpg', 4)
    const { agent, sourceId, connectionId } = await setUp()
    await agent.scanAll()
    const [asset] = (await h.env.DB.prepare("SELECT id FROM assets WHERE filename = 'DSC_0003.jpg'").all<{ id: string }>()).results
    const stopper = setInterval(() => (agent.state.upload(asset!.id)?.parts.length ?? 0) >= 1 && agent.stop(), 5)
    await agent.archiveAll()
    clearInterval(stopper)
    expect((await h.fetch(`/api/sources/${sourceId}`, { method: 'PATCH', body: JSON.stringify({ archive: null }), cookie: admin })).status).toBe(200)
    calls.length = 0
    ;(agent as unknown as { stopping: boolean }).stopping = false
    await agent.archiveAll()
    expect(calls.filter((c) => c.includes('/archive/'))).toEqual(['POST /api/agent/archive/part'])
    expect(await archived(connectionId)).toEqual([])
    // Off until the next config says otherwise.
    calls.length = 0
    await agent.archiveAll()
    expect(calls.filter((c) => c.includes('/archive/'))).toEqual([])
    expect(fileState(agent, '2020/DSC_0003.jpg')).toMatchObject({ attempts: 0 })
  }, 180_000)

  it('archives as before against a cf-dam that gives no codes', async () => {
    await photo('2019/DSC_0001.jpg', 1)
    await photo('2019/DSC_0002.jpg', 2)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    const changed = (await h.env.DB.prepare("SELECT id FROM assets WHERE filename = 'DSC_0001.jpg'").first<{ id: string }>())!.id
    // An older cf-dam: no capabilities, and a plain refusal for a file it thinks has changed.
    cfDam = async (path, init) => {
      if (path === '/api/agent/config') {
        const config = (await (await h.fetch(path, init as RequestInit & { cookie?: string })).json()) as Record<string, unknown>
        delete config.capabilities
        return answer(200, config)
      }
      return path === '/api/agent/archive/start' && String(init?.body).includes(changed) ? answer(409, { error: 'invalid_request', message: 'The file changed since it was indexed.' }) : undefined
    }
    await agent.scanAll()
    await agent.archiveAll()
    expect((await archived(connectionId)).map((c) => c.filename)).toEqual(['DSC_0002.jpg'])
    expect(fileState(agent, '2019/DSC_0001.jpg')).toMatchObject({ attempts: 0 })
  }, 180_000)

  it('holds a file whose bytes changed without its date moving, keeping its parts, until a person chooses', async () => {
    await photo('2020/DSC_0003.jpg', 3, true)
    const { agent, sourceId, connectionId } = await setUp()
    await agent.scanAll()
    const [asset] = (await h.env.DB.prepare('SELECT id FROM assets').all<{ id: string }>()).results
    const stopper = setInterval(() => (agent.state.upload(asset!.id)?.parts.length ?? 0) >= 1 && agent.stop(), 5)
    await agent.archiveAll()
    clearInterval(stopper)
    // A slow machine may finish a second part before the stop lands; whatever was sent must be kept.
    const sent = agent.state.upload(asset!.id)!.parts.length
    expect(sent).toBeGreaterThanOrEqual(1)
    // Part 1's bytes change in place (past the fingerprint's first MiB), and the date is put back: a disk going bad.
    const path = join(photos, '2020', 'DSC_0003.jpg')
    const { mtime } = statSync(path)
    const fd = openSync(path, 'r+')
    writeSync(fd, Buffer.alloc(4096, 0xab), 0, 4096, 2 * 1024 * 1024)
    closeSync(fd)
    utimesSync(path, mtime, mtime)

    calls.length = 0
    const resumed = newAgent()
    await resumed.pair()
    await resumed.scanAll()
    await resumed.archiveAll()
    expect(await archived(connectionId)).toEqual([])
    expect(calls).not.toContain('POST /api/agent/archive/complete')
    expect(calls).not.toContain('POST /api/agent/archive/abort')
    expect(resumed.state.upload(asset!.id)?.parts).toHaveLength(sent)
    expect(resumed.state.archiveCounts().held).toMatchObject({ files: 1, first: { path: '2020/DSC_0003.jpg', reason: 'changed without its date moving (part 1)' } })
    expect(fileState(resumed, '2020/DSC_0003.jpg')).toMatchObject({ attempts: 0 })
    // Held: the next pass leaves it alone.
    calls.length = 0
    await resumed.archiveAll()
    expect(calls.filter((c) => c.includes('/archive/'))).toEqual([])

    // "Archive them as they are now": the old upload goes, and the file as it is now is archived.
    expect((await h.fetch(`/api/sources/${sourceId}/archive/held`, { ...json({ choice: 'archive' }), cookie: admin })).status).toBe(200)
    await resumed.heartbeat()
    await resumed.archiveAll()
    const copies = await archived(connectionId)
    expect(copies).toHaveLength(1)
    expect(await objectSha(copies[0]!.key)).toBe(fileSha(path))
    expect(resumed.state.archiveCounts().held.files).toBe(0)
    const logged = await h.env.DB.prepare("SELECT action FROM activity_log WHERE action LIKE 'archive.held%'").all<{ action: string }>()
    expect(logged.results.map((r) => r.action)).toEqual(['archive.held_archived'])
  }, 180_000)

  it('starts a file again later when it is edited while its parts are going, without counting a try', async () => {
    await photo('2020/DSC_0003.jpg', 3, true)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    const path = join(photos, '2020', 'DSC_0003.jpg')
    // While part 2 goes, someone saves the file (its date moves).
    faultyBucket(agent, (n) => {
      if (n === 2) {
        const fd = openSync(path, 'r+')
        writeSync(fd, Buffer.alloc(4096, 0xcd), 0, 4096, 8 * 1024 * 1024)
        closeSync(fd)
      }
      return undefined
    })
    await agent.archiveAll()
    expect(await archived(connectionId)).toEqual([])
    expect(calls).not.toContain('POST /api/agent/archive/complete')
    expect(calls).toContain('POST /api/agent/archive/abort')
    const [asset] = (await h.env.DB.prepare('SELECT id FROM assets').all<{ id: string }>()).results
    expect(agent.state.upload(asset!.id)).toBeNull()
    expect(fileState(agent, '2020/DSC_0003.jpg')).toMatchObject({ attempts: 0 })
  }, 180_000)

  it('keeps the earlier copy when a changed file is archived again, and counts the change', async () => {
    await photo('2019/DSC_0001.jpg', 1)
    const { agent, connectionId } = await setUp()
    await agent.scanAll()
    await agent.archiveAll()
    const [first] = await archived(connectionId)
    const before = fileSha(join(photos, '2019', 'DSC_0001.jpg'))
    // Overwritten with other bytes (say, encrypted), and left alone for a day.
    await photo('2019/DSC_0001.jpg', 9)
    await agent.scanAll()
    expect(agent.state.archiveCounts()).toMatchObject({ archivedFiles: 1, changedArchived24h: 1 })
    await agent.archiveAll()
    const [now] = await archived(connectionId)
    expect(now!.key).not.toBe(first!.key)
    expect(await objectSha(now!.key)).toBe(fileSha(join(photos, '2019', 'DSC_0001.jpg')))
    const versions = await h.env.DB.prepare('SELECT key, sha256, source_id FROM asset_location_versions').all<{ key: string; sha256: string; source_id: string }>()
    expect(versions.results).toEqual([{ key: first!.key, sha256: before, source_id: expect.any(String) }])
    // Still in the bucket, as it was.
    expect(await objectSha(first!.key)).toBe(before)
    // The bucket can't be removed while it holds it.
    const details = (await (await h.fetch(`/api/connections/${connectionId}/details`, { cookie: admin })).json()) as { uses: { earlierCopies: number } }
    expect(details.uses.earlierCopies).toBe(1)
  }, 180_000)
})

