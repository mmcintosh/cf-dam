/**
 * cf-dam against real AWS S3: storage classes, class changes and Glacier restores, which no local
 * S3 server emulates. Skipped unless AWS_LIVE_BUCKET and AWS credentials are set:
 *
 *   eval "$(aws configure export-credentials --profile cf-dam --format env)"
 *   AWS_LIVE_BUCKET=my-test-bucket npx vitest run test/aws.live.test.ts
 *
 * It writes small objects into every storage class and requests restores (Expedited for Glacier
 * Flexible, a few minutes; Bulk for Deep Archive, which is only checked as started). Costs cents.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runSweep } from '../src/catalog/sweeper'
import { createHarness, json, setUpAdmin, type Harness } from './harness'

const bucket = process.env.AWS_LIVE_BUCKET
const region = process.env.AWS_LIVE_REGION ?? 'us-east-1'
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
}
const camera = new Uint8Array(readFileSync(new URL('./fixtures/camera.jpg', import.meta.url)))
const png = new Uint8Array(readFileSync(new URL('./fixtures/gradient.png', import.meta.url)))
const run = `run-${Date.now().toString(36)}`

let h: Harness
let admin: string
let connectionId: string

interface Asset {
  id: string
  status: string
  camera: { model: string | null }
  renditions: string[]
  locations: { storageClass: string; state: string; archived: boolean; restoreExpiresAt: string | null }[]
}

async function asset(id: string): Promise<Asset> {
  return (await (await h.fetch(`/api/assets/${id}`, { cookie: admin })).json()) as Asset
}

/** The whole upload protocol straight to AWS on presigned URLs, as the browser does it. */
async function upload(bytes: Uint8Array<ArrayBuffer>, filename: string, storageClass: string, previews?: Uint8Array<ArrayBuffer>): Promise<string> {
  const created = await h.fetch('/api/uploads', { ...json({ filename, size: bytes.byteLength, contentType: 'image/jpeg', connectionId, storageClass }), cookie: admin })
  expect(created.status).toBe(201)
  const { uploadId, mode } = (await created.json()) as { uploadId: string; mode: string }
  expect(mode).toBe('direct')
  if (previews) {
    for (const name of ['preview', 'thumb']) {
      const res = await h.fetch(`/api/uploads/${uploadId}/renditions/${name}`, { method: 'PUT', body: previews, headers: { 'Content-Type': 'image/png' }, cookie: admin })
      expect(res.status).toBe(204)
    }
  }
  const { parts } = (await (await h.fetch(`/api/uploads/${uploadId}/part-urls`, { ...json({ partNumbers: [1] }), cookie: admin })).json()) as {
    parts: { url: string; headers: Record<string, string> }[]
  }
  expect(new URL(parts[0]!.url).hostname).toBe(`${bucket}.s3.${region}.amazonaws.com`)
  const put = await fetch(parts[0]!.url, { method: 'PUT', headers: parts[0]!.headers, body: bytes })
  expect(put.status).toBe(200)
  const done = await h.fetch(`/api/uploads/${uploadId}/complete`, { ...json({ parts: [{ partNumber: 1, etag: put.headers.get('ETag') }] }), cookie: admin })
  expect(done.status).toBe(200)
  return ((await done.json()) as { assetId: string }).assetId
}

describe.skipIf(!bucket || !credentials.accessKeyId)('real AWS S3', () => {
  beforeAll(async () => {
    h = await createHarness()
    admin = await setUpAdmin(h)
    const res = await h.fetch('/api/connections', {
      ...json({
        name: 'AWS spike',
        endpoint: `https://s3.${region}.amazonaws.com`,
        region,
        bucket,
        prefix: run,
        ...credentials,
      }),
      cookie: admin,
    })
    expect(res.status).toBe(201)
    const { connection } = (await res.json()) as { connection: { id: string; storageClasses: string[] } }
    expect(connection.storageClasses).toHaveLength(7)
    connectionId = connection.id
  })
  afterAll(async () => h?.dispose())

  it('passes the connection test against the real bucket', async () => {
    expect(await (await h.fetch(`/api/connections/${connectionId}/test`, { method: 'POST', cookie: admin })).json()).toEqual({ ok: true })
  })

  it('stores a STANDARD original and processes it from S3 (range read, renditions)', async () => {
    const id = await upload(camera, 'standard.jpg', 'STANDARD')
    const a = await asset(id)
    expect(a.status).toBe('ready')
    expect(a.camera.model).toBe('Canon EOS R5')
    expect(a.renditions.sort()).toEqual(['preview', 'thumb'])
    expect(a.locations[0]).toMatchObject({ storageClass: 'STANDARD', state: 'present' })
    const original = await h.fetch(`/api/assets/${id}/original`, { cookie: admin, redirect: 'manual' })
    expect(original.status).toBe(302)
    expect(new Uint8Array(await (await fetch(original.headers.get('location')!)).arrayBuffer())).toEqual(camera)
  })

  it('uploads straight into DEEP_ARCHIVE with client previews, and refuses the original until restored', async () => {
    const id = await upload(camera, 'deep.jpg', 'DEEP_ARCHIVE', png)
    const a = await asset(id)
    expect(a.locations[0]).toMatchObject({ storageClass: 'DEEP_ARCHIVE', archived: true })
    expect(a.renditions.sort()).toEqual(['preview', 'thumb'])
    expect((await h.fetch(`/api/assets/${id}/original`, { cookie: admin })).status).toBe(409)

    // Bulk is the cheapest tier: up to 48 hours. Here we only check AWS accepted it.
    const restore = await h.fetch(`/api/assets/${id}/restore`, { ...json({ days: 1, tier: 'Bulk' }), cookie: admin })
    expect(restore.status).toBe(202)
    expect(await restore.json()).toMatchObject({ result: 'started' })
    const again = await h.fetch(`/api/assets/${id}/restore`, { ...json({ days: 1, tier: 'Bulk' }), cookie: admin })
    expect(await again.json()).toMatchObject({ result: 'in-progress' })
    expect(await (await h.fetch(`/api/assets/${id}/refresh`, { method: 'POST', cookie: admin })).json()).toMatchObject({ state: 'restoring', storageClass: 'DEEP_ARCHIVE' })
  })

  it('moves an original between classes in place: STANDARD → STANDARD_IA → GLACIER_IR → INTELLIGENT_TIERING', async () => {
    const id = await upload(camera, 'mover.jpg', 'STANDARD')
    for (const target of ['STANDARD_IA', 'GLACIER_IR', 'INTELLIGENT_TIERING']) {
      const moved = await h.fetch(`/api/assets/${id}/storage-class`, { ...json({ storageClass: target }), cookie: admin })
      expect(moved.status, target).toBe(200)
      expect(await (await h.fetch(`/api/assets/${id}/refresh`, { method: 'POST', cookie: admin })).json()).toMatchObject({ storageClass: target, state: 'present' })
    }
  })

  it('restores from Glacier Flexible Retrieval with Expedited, and the sweep marks it ready', async () => {
    const id = await upload(camera, 'flexible.jpg', 'GLACIER', png)
    const restore = await h.fetch(`/api/assets/${id}/restore`, { ...json({ days: 1, tier: 'Expedited' }), cookie: admin })
    expect(restore.status).toBe(202)

    // Expedited restores of small objects usually finish in 1–5 minutes.
    const deadline = Date.now() + 9 * 60_000
    let state = 'restoring'
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20_000))
      await runSweep(h.env)
      state = (await asset(id)).locations[0]!.state
      if (state === 'restored') break
    }
    expect(state).toBe('restored')
    const original = await h.fetch(`/api/assets/${id}/original`, { cookie: admin, redirect: 'manual' })
    expect(original.status).toBe(302)
    expect(new Uint8Array(await (await fetch(original.headers.get('location')!)).arrayBuffer())).toEqual(camera)
  }, 10 * 60_000)
})
