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
  /** The bucket refusing everything (its code), and when the next pass may try again. */
  bucket: { refusing: string | null; until: string | null }
}

export const newArchiveProgress = (): ArchiveProgress => ({
  phase: 'idle', current: null, filesDone: 0, bytesSent: 0, startedAt: null, speed: 0, filesLeft: 0, bytesLeft: 0, lastError: null,
  bucket: { refusing: null, until: null },
})

/** A file is archived once it has been left alone this long: Deep Archive bills 180 days for every version. */
export const STABLE_FOR_MS = 24 * 60 * 60_000
/** After the bucket refuses everything: wait this long before the next pass, doubling up to the most. */
export const BUCKET_WAIT_MS = 15 * 60_000
export const BUCKET_WAIT_MAX_MS = 2 * 60 * 60_000
/** The bucket ending an upload this many times before it finishes gives the file up (its lifecycle rule, likely). */
export const MAX_RESTARTS = 3

/** Within the archive hours, local time. From 22 to 7 crosses midnight; equal hours mean all day. */
export function inWindow(s: ArchiveSettings, now = new Date()): boolean {
  const h = now.getHours()
  if (s.fromHour === s.toHour) return true
  return s.fromHour < s.toHour ? h >= s.fromHour && h < s.toHour : h >= s.fromHour || h < s.toHour
}

/** Kept by the agent between passes: how long to leave a bucket that refuses everything. */
export interface BucketBackoff {
  until: number
  waitMs: number
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
  /** Kept across passes by the agent. */
  backoff?: BucketBackoff
  /** For the parts' PUTs to the bucket; tests stand in their own. */
  fetchImpl?: FetchLike
  now?: () => Date
  log?: (...args: unknown[]) => void
}

/** cf-dam says this helper no longer archives (to that bucket): stop until the next config says otherwise. */
export class NotArchiving extends Error {}
/** The bucket refuses everything: stop, and wait before trying again. */
class BucketRefusing extends Error {
  constructor(readonly code: string) {
    super(`The bucket is refusing: ${code}`)
  }
}
/** The upload is over on the bucket's side (ended by its lifecycle rule, by hand, or never known): start the file again. */
class UploadGone extends Error {}
/** Leave the file for now, without counting a try (it changed, or the photo is gone): the next scan sees to it. */
class SkipFile extends Error {}
/** The bucket refused one part (not the whole bucket, not this upload). */
class PartRefused extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const isCode = (error: unknown, status: number, code: string) => error instanceof ApiError && error.status === status && error.code === code

/** What one failed file means for the pass. */
type Verdict = 'stop' | 'bucket' | 'off' | 'skip' | 'internal' | 'count'
function verdict(error: unknown): Verdict {
  if (error instanceof Paused || error instanceof Unpaired || error instanceof LinkError) return 'stop'
  if (error instanceof NotArchiving) return 'off'
  if (error instanceof BucketRefusing) return 'bucket'
  if (error instanceof SkipFile) return 'skip'
  if (error instanceof ApiError) {
    if (error.code === 'storage') return error.detail.scope === 'bucket' ? 'bucket' : 'count'
    if (error.code === 'not_archiving') return 'off'
    if (error.code === 'internal_error') return 'internal'
    // An HTML 5xx (a proxy, Cloudflare itself) or cf-dam busy: the link.
    if (error.status >= 500) return 'stop'
    if (error.code === 'changed' || error.code === 'no_photo') return 'skip'
    // An older cf-dam, which gives no codes: as before, a refusal leaves the file for the next scan.
    if ((error.status === 404 || error.status === 409) && (error.code === null || error.code === 'invalid_request')) return 'skip'
  }
  return 'count'
}

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

/** S3's answers worth trying again as they are (with a wait): the bucket or the line was busy. */
const PASSING = new Set(['RequestTimeout', 'IncompleteBody', 'SlowDown', 'TooManyRequests', 'OperationAborted', 'InternalError', 'ServiceUnavailable'])
/** The bytes arrived damaged (the checksum is made from the very buffer sent): read them again and send once more. */
const DAMAGED = new Set(['BadDigest', 'XAmzContentSHA256Mismatch', 'InvalidDigest'])
/** The signed URL (or the credentials it was signed with) ran out: sign it again. */
const expired = (code: string | undefined, text: string) =>
  code === 'ExpiredToken' || code === 'SignatureDoesNotMatch' || (code === 'AccessDenied' && /expired/i.test(text))

export interface PartRequest {
  url: string
  headers: Record<string, string>
}

/**
 * PUT one part to the bucket. A passing refusal (busy, timed out) and the network are tried again with a wait; an
 * expired URL is signed again (twice at most); damaged bytes are read again once. Anything else is the bucket refusing this part:
 * the upload is kept, so the parts already sent stay for the next try.
 */
export async function putPart(fetchImpl: FetchLike, sign: () => Promise<PartRequest>, reread: () => Promise<Uint8Array>, first: Uint8Array): Promise<string> {
  let request = await sign()
  let body = first
  let signedAgain = 0
  let readAgain = false
  let delay = 2000
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetchImpl(request.url, { method: 'PUT', headers: request.headers, body: body as unknown as BodyInit })
    } catch (error) {
      if (attempt >= 5) throw new LinkError(`Sending a part to the bucket: ${message(error)}`)
      await sleep(delay)
      delay = Math.min(delay * 2, 60_000)
      continue
    }
    if (res.ok) {
      const etag = res.headers.get('ETag')
      if (!etag) throw new PartRefused('The bucket returned no ETag.')
      return etag
    }
    const text = await res.text().catch(() => '')
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1]
    if ((res.status >= 500 || res.status === 429 || (code && PASSING.has(code))) && attempt < 5) {
      await sleep(delay)
      delay = Math.min(delay * 2, 60_000)
      continue
    }
    if (code === 'NoSuchUpload') throw new UploadGone(`The bucket no longer knows this upload (${code}).`)
    // Expired twice is possible (the URL, then the credentials it was signed with); a third time is a refusal.
    if (expired(code, text) && signedAgain < 2) {
      signedAgain++
      request = await sign()
      continue
    }
    if (code && DAMAGED.has(code) && !readAgain) {
      readAgain = true
      body = await reread()
      continue
    }
    throw new PartRefused(`The bucket refused a part: ${code ?? `HTTP ${res.status}`}`)
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
 * pass's budget runs out, or the agent is stopped or paused. Throws NotArchiving when cf-dam says this helper
 * no longer archives.
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
  // The bucket refused everything a short while ago: leave it be until the wait is over.
  if (ctx.backoff && startedMs < ctx.backoff.until) {
    progress.phase = 'waiting'
    return
  }
  progress.phase = 'archiving'
  progress.startedAt = now().toISOString()
  progress.filesDone = 0
  progress.bytesSent = 0
  // A failure from an earlier pass is history: this pass reports its own.
  progress.lastError = null
  const awake = stayAwake()
  const keepGoing = () => !ctx.shouldStop() && inWindow(ctx.settings, now()) && now().getTime() - startedMs < ctx.budgetMs
  // The speed limit is an average over the whole pass, in real time.
  const passStarted = Date.now()
  // Files cf-dam failed on (a 500): their tries count only once a later file gets through, which shows cf-dam
  // itself is working. Two in a row, and it's cf-dam: stop without blaming either.
  let failedOnCfDam: { file: ArchiveCandidate; reason: string }[] = []
  const failed = (file: ArchiveCandidate, reason: string) => {
    state.archiveFailed(file.root_id, file.path, reason)
    progress.lastError = `${file.path}: ${reason}`
    ctx.log?.('Archiving failed:', progress.lastError)
  }
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
          const sent = await archiveFile(ctx, file, join(here, file.path), keepGoing, passStarted)
          if (sent === 'stopped') return
          // Through: cf-dam and the bucket are answering.
          for (const f of failedOnCfDam) failed(f.file, f.reason)
          failedOnCfDam = []
          if (ctx.backoff) Object.assign(ctx.backoff, { until: 0, waitMs: 0 })
          progress.bucket = { refusing: null, until: null }
          if (sent === 'done') {
            progress.filesDone++
            progress.filesLeft = Math.max(0, progress.filesLeft - 1)
            progress.bytesLeft = Math.max(0, progress.bytesLeft - file.size)
          }
        } catch (error) {
          switch (verdict(error)) {
            case 'stop':
              throw error
            case 'off':
              throw new NotArchiving(message(error))
            case 'bucket': {
              // Not this file's fault: nothing is counted against it. Wait, longer each time it goes on.
              const code = error instanceof BucketRefusing ? error.code : ((error as ApiError).detail.s3Code ?? 'refused')
              const waitMs = Math.min(Math.max(BUCKET_WAIT_MS, (ctx.backoff?.waitMs ?? 0) * 2), BUCKET_WAIT_MAX_MS)
              const until = now().getTime() + waitMs
              if (ctx.backoff) Object.assign(ctx.backoff, { until, waitMs })
              progress.bucket = { refusing: code, until: new Date(until).toISOString() }
              progress.lastError = `The bucket is refusing: ${code}`
              ctx.log?.(`The bucket is refusing (${code}): archiving waits ${Math.round(waitMs / 60_000)} minutes.`)
              return
            }
            case 'skip':
              ctx.log?.('Archiving left for now:', `${file.path}: ${message(error)}`)
              break
            case 'internal':
              failedOnCfDam.push({ file, reason: message(error) })
              if (failedOnCfDam.length >= 2) {
                ctx.log?.('cf-dam failed on two files in a row; archiving stops for now.')
                return
              }
              break
            case 'count':
              failed(file, message(error))
              break
          }
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
async function archiveFile(ctx: ArchiveCtx, file: ArchiveCandidate, path: string, keepGoing: () => boolean, passStarted: number): Promise<'done' | 'skipped' | 'stopped'> {
  const { state } = ctx
  // The bucket ending the upload starts the file again, once a pass; after a few times, the file is given up.
  for (let restarted = false; ; restarted = true) {
    try {
      return await archiveOnce(ctx, file, path, keepGoing, passStarted)
    } catch (error) {
      if (!(error instanceof UploadGone || isCode(error, 404, 'no_upload'))) throw error
      state.dropUpload(file.asset_id)
      const restarts = state.archiveRestarted(file.root_id, file.path)
      if (restarts >= MAX_RESTARTS) {
        const reason = 'The bucket ended the upload before it finished, three times (its lifecycle rule for unfinished uploads?).'
        state.archiveGiveUp(file.root_id, file.path, reason)
        ctx.progress.lastError = `${file.path}: ${reason}`
        ctx.log?.('Archiving gave up:', ctx.progress.lastError)
        return 'skipped'
      }
      if (restarted) return 'skipped'
      ctx.log?.(`Starting ${file.path} again: ${message(error)}`)
    }
  }
}

async function archiveOnce(ctx: ArchiveCtx, file: ArchiveCandidate, path: string, keepGoing: () => boolean, passStarted: number): Promise<'done' | 'skipped' | 'stopped'> {
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
    let plan = await start(false)
    if (plan.result === 'archived') {
      state.archived(file.root_id, file.path, file.quick_hash)
      return 'done'
    }
    if (plan.result === 'verify') {
      // The same size and fingerprint as a photo already archived: the same bytes, or upload.
      if ((await sha256File(path)) === plan.sha256) {
        try {
          await api.call('POST', '/api/agent/archive/link', { assetId: file.asset_id, fromAssetId: plan.fromAssetId, sha256: plan.sha256 })
          state.archived(file.root_id, file.path, file.quick_hash)
          return 'done'
        } catch (error) {
          // That copy went (or changed) in the meantime: upload this one after all.
          if (!isCode(error, 409, 'twin_mismatch')) throw error
        }
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
  return sendParts(ctx, file, path, upload, keepGoing, passStarted)
}

async function sendParts(ctx: ArchiveCtx, file: ArchiveCandidate, path: string, upload: ArchiveUpload, keepGoing: () => boolean, passStarted: number): Promise<'done' | 'stopped'> {
  const { api, state, progress } = ctx
  const fetchImpl = ctx.fetchImpl ?? fetch
  const sent = new Map(upload.parts.map((p) => [p.partNumber, p]))
  const whole = createHash('sha256')
  const handle = await open(path, 'r')
  const rate = ctx.settings.maxMbps > 0 ? ctx.settings.maxMbps * 125_000 : 0
  try {
    for (let n = 1; n <= upload.part_count; n++) {
      const offset = (n - 1) * upload.part_size
      const length = Math.min(upload.part_size, upload.size - offset)
      const readPart = async () => {
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        if (bytesRead !== length) throw new SkipFile('The file is shorter than when it was indexed.')
        return buffer
      }
      const buffer = await readPart()
      // Parts already in the bucket are read again only for the whole file's SHA-256.
      whole.update(buffer)
      if (sent.has(n)) continue
      if (!keepGoing()) return 'stopped'
      const checksum = createHash('sha256').update(buffer).digest('base64')
      const sign = async () =>
        (await api.call<PartRequest>('POST', '/api/agent/archive/part', { uploadId: upload.upload_id, partNumber: n, checksum })).body
      const reread = async () => {
        const again = await readPart()
        // Read again, the bytes are different: the file is changing under us. Leave it for the next scan.
        if (createHash('sha256').update(again).digest('base64') !== checksum) {
          await api.call('POST', '/api/agent/archive/abort', { uploadId: upload.upload_id }).catch(() => {})
          state.dropUpload(file.asset_id)
          throw new SkipFile('The file changed while it was being archived.')
        }
        return again
      }
      const etag = await putPart(fetchImpl, sign, reread, buffer)
      const part = { partNumber: n, etag, checksum }
      state.savePart(file.asset_id, part)
      sent.set(n, part)
      progress.bytesSent += length
      progress.speed = Math.round(progress.bytesSent / Math.max(1, (Date.now() - Date.parse(progress.startedAt ?? new Date().toISOString())) / 1000))
      // The speed limit: wait until this pass's average is back under it.
      if (rate > 0) {
        // Against the whole pass: bytesSent counts every file in it, so a per-file start would wait again for all of them.
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
    // An older cf-dam: a 404 or 409 here meant the upload was given up or refused. Start the file again next time.
    if (error instanceof ApiError && (error.status === 404 || error.status === 409) && error.code !== 'no_upload' && error.code !== 'not_archiving') state.dropUpload(file.asset_id)
    throw error
  }
  state.archived(file.root_id, file.path, file.quick_hash)
  state.dropUpload(file.asset_id)
  return 'done'
}
