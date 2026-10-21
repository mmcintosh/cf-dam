/**
 * Archiving originals to the bucket cf-dam names (plans/PLAN-5o-v1.md in cf-dam-docs): file by file,
 * from the agent's own list, oldest folders first. For each file cf-dam says what to do; an upload goes
 * straight to the bucket, a part at a time, each part carrying its SHA-256 so the bucket refuses bytes
 * that don't match. Finished parts are recorded, so a stop (sleep, reboot, network, pause, the end of the
 * archive hours) carries on from the next part. Only reads files; never changes them.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ApiError, Paused, Unpaired, LinkError, type Api, type FetchLike } from './api.ts'
import type { ArchiveCandidate, ArchiveUpload, State } from './state.ts'

export interface ArchiveSettings {
  fromHour: number
  toHour: number
  /** Megabits a second; 0: no limit. */
  maxMbps: number
}

export interface ArchiveProgress {
  phase: 'idle' | 'archiving' | 'waiting'
  current: string | null
  /** This run. */
  filesDone: number
  bytesSent: number
  startedAt: string | null
  /** Bytes a second over this run. */
  speed: number
  filesLeft: number
  bytesLeft: number
  lastError: string | null
}

export const newArchiveProgress = (): ArchiveProgress => ({
  phase: 'idle', current: null, filesDone: 0, bytesSent: 0, startedAt: null, speed: 0, filesLeft: 0, bytesLeft: 0, lastError: null,
})

/** A file is archived once it has been left alone this long: Deep Archive bills 180 days for every version. */
export const STABLE_FOR_MS = 24 * 60 * 60_000

/** Within the archive hours, local time. From 22 to 7 crosses midnight; equal hours mean all day. */
export function inWindow(s: ArchiveSettings, now = new Date()): boolean {
  const h = now.getHours()
  if (s.fromHour === s.toHour) return true
  return s.fromHour < s.toHour ? h >= s.fromHour && h < s.toHour : h >= s.fromHour || h < s.toHour
}

export interface ArchiveCtx {
  api: Api
  state: State
  settings: ArchiveSettings
  /** Where each folder is right now (null: its drive isn't connected). */
  roots: Map<string, string | null>
  progress: ArchiveProgress
  shouldStop: () => boolean
  /** How long this pass may run before handing back (so new photos get indexed). */
  budgetMs: number
  /** For the parts' PUTs to the bucket; tests stand in their own. */
  fetchImpl?: FetchLike
  now?: () => Date
  log?: (...args: unknown[]) => void
}

class PartRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
/** Stops that end the whole pass: the link or cf-dam, not one file. */
const passStopper = (error: unknown) => error instanceof Paused || error instanceof Unpaired || error instanceof LinkError || (error instanceof ApiError && error.status >= 500)

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  const handle = await open(path, 'r')
  try {
    for await (const chunk of handle.createReadStream({ highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk as Buffer)
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

/** PUT one part to the bucket, retrying the network and the bucket's 5xx; a 4xx is a refusal. */
async function putPart(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: Uint8Array): Promise<string> {
  let delay = 2000
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetchImpl(url, { method: 'PUT', headers, body: body as unknown as BodyInit })
    } catch (error) {
      if (attempt >= 5) throw new LinkError(`Sending a part to the bucket: ${message(error)}`)
      await sleep(delay)
      delay = Math.min(delay * 2, 60_000)
      continue
    }
    if (res.ok) {
      const etag = res.headers.get('ETag')
      if (!etag) throw new PartRefused('The bucket returned no ETag.', 502)
      return etag
    }
    const text = await res.text().catch(() => '')
    if (res.status >= 500 && attempt < 5) {
      await sleep(delay)
      delay = Math.min(delay * 2, 60_000)
      continue
    }
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1]
    throw new PartRefused(`The bucket refused a part: ${code ?? `HTTP ${res.status}`}`, res.status)
  }
}

/** Keep a Mac awake while archiving (as `caffeinate -i` does); nothing elsewhere. */
function stayAwake(): ChildProcess | null {
  if (process.platform !== 'darwin') return null
  try {
    const child = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
    child.on('error', () => {})
    return child
  } catch {
    return null
  }
}

/**
 * One archiving pass: through the files still to archive, until they're done, the hours end, the
 * pass's budget runs out, or the agent is stopped or paused.
 */
export async function archivePass(ctx: ArchiveCtx): Promise<void> {
  const { state, progress } = ctx
  const now = ctx.now ?? (() => new Date())
  const startedMs = now().getTime()
  const stableBefore = startedMs - STABLE_FOR_MS
  const left = state.archiveLeft(stableBefore)
  progress.filesLeft = left.files
  progress.bytesLeft = left.bytes
  if (left.files === 0) {
    progress.phase = 'idle'
    return
  }
  if (!inWindow(ctx.settings, now())) {
    progress.phase = 'waiting'
    return
  }
  progress.phase = 'archiving'
  progress.startedAt = now().toISOString()
  progress.filesDone = 0
  progress.bytesSent = 0
  const awake = stayAwake()
  const keepGoing = () => !ctx.shouldStop() && inWindow(ctx.settings, now()) && now().getTime() - startedMs < ctx.budgetMs
  try {
    let after: { rootId: string; path: string } | null = null
    while (keepGoing()) {
      const batch = state.archiveCandidates(after, stableBefore, 50)
      if (batch.length === 0) break
      for (const file of batch) {
        if (!keepGoing()) break
        after = { rootId: file.root_id, path: file.path }
        const here = ctx.roots.get(file.root_id)
        if (!here) continue
        progress.current = file.path
        try {
          const sent = await archiveFile(ctx, file, join(here, file.path), keepGoing)
          if (sent === 'stopped') break
          if (sent === 'done') {
            progress.filesDone++
            progress.filesLeft = Math.max(0, progress.filesLeft - 1)
            progress.bytesLeft = Math.max(0, progress.bytesLeft - file.size)
          }
        } catch (error) {
          if (passStopper(error)) throw error
          state.archiveFailed(file.root_id, file.path)
          progress.lastError = `${file.path}: ${message(error)}`
          ctx.log?.('Archiving failed:', progress.lastError)
        }
      }
    }
  } finally {
    awake?.kill()
    progress.current = null
    progress.phase = inWindow(ctx.settings, now()) ? 'idle' : 'waiting'
  }
}

/** One file: done, skipped (changed since indexed: the next scan sees to it), or stopped mid-way. */
async function archiveFile(ctx: ArchiveCtx, file: ArchiveCandidate, path: string, keepGoing: () => boolean): Promise<'done' | 'skipped' | 'stopped'> {
  const { api, state } = ctx
  const info = await stat(path).catch(() => null)
  if (!info || info.size !== file.size || Math.floor(info.mtimeMs) !== file.mtime_ms) return 'skipped'

  let upload = state.upload(file.asset_id)
  if (upload && (upload.quick_hash !== file.quick_hash || upload.size !== file.size)) {
    // The file changed since this upload began: give it up and start again.
    await api.call('POST', '/api/agent/archive/abort', { uploadId: upload.upload_id }).catch(() => {})
    state.dropUpload(file.asset_id)
    upload = null
  }

  if (!upload) {
    const start = async (skipTwin: boolean) =>
      (
        await api.call<{ result: 'archived' | 'verify' | 'upload'; sha256?: string; fromAssetId?: string; uploadId?: string; partSize?: number; partCount?: number }>(
          'POST',
          '/api/agent/archive/start',
          { assetId: file.asset_id, size: file.size, quickHash: file.quick_hash, skipTwin },
        )
      ).body
    let plan
    try {
      plan = await start(false)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && !(error instanceof Paused)) return 'skipped'
      throw error
    }
    if (plan.result === 'archived') {
      state.archived(file.root_id, file.path, file.quick_hash)
      return 'done'
    }
    if (plan.result === 'verify') {
      // The same size and fingerprint as a photo already archived: the same bytes, or upload.
      if ((await sha256File(path)) === plan.sha256) {
        await api.call('POST', '/api/agent/archive/link', { assetId: file.asset_id, fromAssetId: plan.fromAssetId, sha256: plan.sha256 })
        state.archived(file.root_id, file.path, file.quick_hash)
        return 'done'
      }
      plan = await start(true)
    }
    if (plan.result !== 'upload') throw new Error(`cf-dam answered ${plan.result} to a second start.`)
    state.saveUpload({
      asset_id: file.asset_id, root_id: file.root_id, path: file.path, upload_id: plan.uploadId!, size: file.size,
      quick_hash: file.quick_hash, part_size: plan.partSize!, part_count: plan.partCount!, started_at: new Date().toISOString(),
    })
    upload = state.upload(file.asset_id)!
  }
  return sendParts(ctx, file, path, upload, keepGoing)
}

async function sendParts(ctx: ArchiveCtx, file: ArchiveCandidate, path: string, upload: ArchiveUpload, keepGoing: () => boolean): Promise<'done' | 'stopped'> {
  const { api, state, progress } = ctx
  const fetchImpl = ctx.fetchImpl ?? fetch
  const sent = new Map(upload.parts.map((p) => [p.partNumber, p]))
  const whole = createHash('sha256')
  const handle = await open(path, 'r')
  const passStarted = Date.now()
  const rate = ctx.settings.maxMbps > 0 ? ctx.settings.maxMbps * 125_000 : 0
  try {
    for (let n = 1; n <= upload.part_count; n++) {
      const offset = (n - 1) * upload.part_size
      const length = Math.min(upload.part_size, upload.size - offset)
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      if (bytesRead !== length) throw new Error('The file is shorter than when it was indexed.')
      // Parts already in the bucket are read again only for the whole file's SHA-256.
      whole.update(buffer)
      if (sent.has(n)) continue
      if (!keepGoing()) return 'stopped'
      const checksum = createHash('sha256').update(buffer).digest('base64')
      const signed = await api.call<{ url: string; headers: Record<string, string> }>('POST', '/api/agent/archive/part', { uploadId: upload.upload_id, partNumber: n, checksum })
      let etag: string
      try {
        etag = await putPart(fetchImpl, signed.body.url, signed.body.headers, buffer)
      } catch (error) {
        if (error instanceof PartRefused && error.status < 500) {
          // The bytes didn't match their checksum (the file changing under us, or a disk error): start the file again.
          await api.call('POST', '/api/agent/archive/abort', { uploadId: upload.upload_id }).catch(() => {})
          state.dropUpload(file.asset_id)
        }
        throw error
      }
      const part = { partNumber: n, etag, checksum }
      state.savePart(file.asset_id, part)
      sent.set(n, part)
      progress.bytesSent += length
      progress.speed = Math.round(progress.bytesSent / Math.max(1, (Date.now() - Date.parse(progress.startedAt ?? new Date().toISOString())) / 1000))
      // The speed limit: wait until this pass's average is back under it.
      if (rate > 0) {
        const due = (progress.bytesSent / rate) * 1000 - (Date.now() - passStarted)
        for (let waited = 0; waited < due && keepGoing(); waited += 1000) await sleep(Math.min(1000, due - waited))
      }
    }
  } finally {
    await handle.close()
  }
  try {
    await api.call('POST', '/api/agent/archive/complete', { uploadId: upload.upload_id, parts: [...sent.values()].sort((a, b) => a.partNumber - b.partNumber), sha256: whole.digest('hex') })
  } catch (error) {
    // Given up by cf-dam (a week old) or refused at the end: start the file again next time.
    if (error instanceof ApiError && (error.status === 404 || error.status === 409)) state.dropUpload(file.asset_id)
    throw error
  }
  state.archived(file.root_id, file.path, file.quick_hash)
  state.dropUpload(file.asset_id)
  return 'done'
}
