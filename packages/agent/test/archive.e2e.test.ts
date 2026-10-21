/**
 * Archiving, end to end: the real agent and the real API (in-process), sending originals to a real
 * S3-compatible server. Runs when S3_TEST_ENDPOINT is set (as in CI), like the API's S3 tests.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs'
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
  const client = new AwsClient({ ...s3Credentials, service: 's3', region: 'us-east-1' })

  beforeEach(async () => {
    h = await createHarness({ ASSETS, ARCHIVE_PART_BYTES: String(PART) })
    admin = await setUpAdmin(h)
    photos = mkdtempSync(join(tmpdir(), 'nas-photos-'))
    data = mkdtempSync(join(tmpdir(), 'nas-data-'))
    calls.length = 0
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
      return h.fetch(path, init as RequestInit & { cookie?: string })
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
})
