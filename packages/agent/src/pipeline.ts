/**
 * A scan: walk the folders, work out what changed, send new and changed photos in batches (metadata
 * and previews; previews are uploaded only where cf-dam asks for them), then report what's gone.
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ApiError, isLinkError, type Api } from './api.ts'
import type { AgentMetadata, Extractor } from './extract.ts'
import { render, renderSheet, type Rendered } from './render.ts'
import { isVideo, plan, quickHash as qh, walk, type Found, type Plan } from './scan.ts'
import { STOPPED_READING, type FileRow, type State } from './state.ts'

export interface Root {
  id: string
  /** As cf-dam stores it (the path when the folder was added). */
  path: string
  include: string[]
  exclude: string[]
  volume: { id: string; label: string | null; path: string | null } | null
  offlineSince: string | null
}

export interface Progress {
  root: string | null
  current: string | null
  found: number
  queued: number
  sent: number
  failed: number
  missing: number
  startedAt: string | null
  lastError: string | null
  /** Folders the system wouldn't let the agent read, this scan. */
  denied: string[]
}

export const newProgress = (): Progress => ({ root: null, current: null, found: 0, queued: 0, sent: 0, failed: 0, missing: 0, startedAt: null, lastError: null, denied: [] })

export interface Ctx {
  api: Api
  state: State
  extractor: Extractor
  workers: number
  /** Thumbs first above this many photos to send (THUMBS_FIRST unless a test says otherwise). */
  thumbsFirstOver?: number
  defaultExcludes: string[]
  progress: Progress
  /** Checked between files and batches, so pausing or shutting down takes effect within a batch. */
  shouldStop: () => boolean
}

/** Photos per request. Small enough that previews for a batch fit comfortably in memory. */
const BATCH = 20

/**
 * A scan with more than this many photos to send sends their thumbs first, so the whole lot shows in
 * cf-dam in a fraction of the time (a JPEG's thumb decodes at an eighth of its size, and is a tenth
 * of the upload), then goes back for the previews. Fewer than this go in one pass: reading each file
 * twice isn't worth it.
 */
export const THUMBS_FIRST = 200

/**
 * A folder that empties out is taken for a mount gone wrong, not a folder really emptied, until it
 * has looked empty this many scans in a row, over at least this long.
 */
const EMPTY_SCANS = 3
const EMPTY_FOR_MS = 24 * 60 * 60_000

interface Item {
  file: Found
  quickHash: string
  /** Where it was, when it looks like a move: a gone file with the same fingerprint, in any folder. */
  previous?: { rootId: string; path: string }
  /** The agent died while reading it last time, maybe because of it: it's read on its own. */
  suspect: boolean
}

interface BatchResult {
  path: string
  assetId?: string
  result: 'created' | 'updated' | 'unchanged' | 'moved' | 'rejected'
  needs?: ('thumb' | 'preview')[]
  ready?: boolean
  error?: string
}

interface Prepared {
  item: Item
  meta: AgentMetadata | undefined
  rendered: Rendered | null
  error: string | null
}

/** `limit` at a time; after a failure no new ones start, and the first failure is thrown. */
async function inParallel<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  let failed = false
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !failed) {
        const i = next++
        try {
          out[i] = await fn(items[i]!)
        } catch (error) {
          failed = true
          throw error
        }
      }
    }),
  )
  return out
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

interface Surveyed {
  root: Root
  here: string
  work: Plan['work']
  gone: FileRow[]
}

/**
 * One pass over the agent's folders, in three steps, so that a file moved from one folder to another
 * is recognised whichever of the two is scanned first:
 *  1. walk every folder and work out what's new, changed and gone;
 *  2. folder by folder, fingerprint the new and changed files and send them (a new file with the
 *     fingerprint of a gone one, in any folder, is that file moved);
 *  3. only then tell cf-dam what's gone, and forget it.
 * `here` is where each folder is right now (a drive may have come back at a new mount point), or null
 * when its drive isn't connected. File paths sent to cf-dam are relative, so they don't change with it.
 * Stopping (pause, shutdown) skips step 3: nothing is reported missing from a scan that didn't finish.
 */
export async function scanRoots(ctx: Ctx, roots: { root: Root; here: string | null }[]): Promise<void> {
  const { api, state, progress } = ctx
  progress.startedAt = new Date().toISOString()

  const surveyed: Surveyed[] = []
  for (const { root, here } of roots) {
    if (ctx.shouldStop()) return
    progress.root = root.path
    const s = await survey(ctx, root, here)
    if (s) surveyed.push(s)
  }

  const goneByHash = new Map<string, { rootId: string; path: string }>()
  for (const s of surveyed) for (const g of s.gone) if (g.quick_hash && g.status !== 'error') goneByHash.set(g.quick_hash, { rootId: s.root.id, path: g.path })

  const thumbsFirst = surveyed.reduce((n, s) => n + s.work.length, 0) > (ctx.thumbsFirstOver ?? THUMBS_FIRST)
  for (const { root, here, work } of surveyed) {
    progress.root = root.path
    const items: Item[] = []
    for (const { file, known } of work) {
      if (ctx.shouldStop()) return
      try {
        const quickHash = await qh(join(here, file.path), file.size)
        const previous = !known ? goneByHash.get(quickHash) : undefined
        if (previous) goneByHash.delete(quickHash)
        items.push({ file, quickHash, previous, suspect: known?.status === 'error' && known.error === STOPPED_READING })
      } catch (error) {
        progress.failed++
        progress.lastError = `${file.path}: ${message(error)}`
        state.failed(root.id, file.path, { size: file.size, mtimeMs: file.mtimeMs, quickHash: null }, message(error))
      }
    }
    for (let i = 0; i < items.length; i += BATCH) {
      if (ctx.shouldStop()) return
      await sendBatch(ctx, root, here, items.slice(i, i + BATCH), thumbsFirst)
    }
  }

  // What's gone, in chunks. A file that moved is reported too: cf-dam already has it at its new
  // path, so nothing is marked; and if the move didn't go through, the photo is rightly missing
  // until the next scan finds it by its fingerprint.
  for (const { root, gone } of surveyed) {
    if (ctx.shouldStop()) return
    const missing = gone.map((g) => g.path)
    for (let i = 0; i === 0 || i < missing.length; i += 5000) {
      const chunk = missing.slice(i, i + 5000)
      const last = i + 5000 >= missing.length
      const res = await api.call<{ missing: number }>('POST', '/api/agent/scans/complete', { root: root.id, missing: chunk, final: last })
      progress.missing += res.body.missing
    }
    state.forget(root.id, missing)
  }

  // The previews of photos sent with their thumbs only, this scan or an earlier one cut short.
  for (const { root, here } of surveyed) await sendPreviewsLater(ctx, root, here)
  progress.root = null
  progress.current = null
}

/** Step 1 for one folder. Null when it's offline: its drive unplugged, its share unmounted. */
async function survey(ctx: Ctx, root: Root, here: string | null): Promise<Surveyed | null> {
  const { api, state, progress } = ctx
  // Offline, not empty: never report its photos missing for that.
  const reachable = here !== null && (await stat(here).then((s) => s.isDirectory()).catch(() => false))
  const { found, unreadable, denied } = reachable
    ? await walk(here, [...ctx.defaultExcludes, ...root.exclude], root.include)
    : { found: new Map<string, Found>(), unreadable: [], denied: [] }
  // Refused by the system: said plainly, as it otherwise looks like an empty folder.
  if (denied.length > 0) {
    const where = denied[0] === '' ? root.path : `${root.path}/${denied[0]}`
    progress.denied.push(...denied.map((d) => (d === '' ? root.path : `${root.path}/${d}`)))
    progress.lastError =
      process.platform === 'darwin'
        ? `macOS won't let the agent read ${where}. In System Settings → Privacy & Security, allow it under Files and Folders, or add node to Full Disk Access, then restart the agent.`
        : `Not allowed to read ${where}: check the agent's permissions on this folder.`
  }
  const known = state.files(root.id)
  const patterns = JSON.stringify([ctx.defaultExcludes, root.exclude, root.include])
  // A folder that suddenly shows nothing at all, when we knew files there, is most likely a mount gone
  // wrong (a share's mount point left bare): offline. Unless that's believable at once (the patterns
  // changed and the folder isn't bare), or it stays that way three scans and a day: really emptied.
  if (!reachable || (found.size === 0 && known.size > 0 && !(await emptied(ctx, root, here, patterns)))) {
    if (!root.offlineSince) await api.call('POST', `/api/agent/roots/${root.id}/status`, { online: false })
    return null
  }
  // Not once emptiness is accepted: if this scan is stopped before it reports the files gone, the
  // next one accepts it again instead of starting the wait over.
  if (found.size > 0 || known.size === 0) state.sawFiles(root.id, patterns)
  if (root.offlineSince) await api.call('POST', `/api/agent/roots/${root.id}/status`, { online: true })
  const { work, gone } = plan(found, known, unreadable)
  progress.found += found.size
  progress.queued += work.length
  return { root, here, work, gone }
}

/** Whether a folder that now shows no files, where files were known, really was emptied. */
async function emptied(ctx: Ctx, root: Root, here: string, patterns: string): Promise<boolean> {
  const was = ctx.state.patterns(root.id)
  if (was !== null && was !== patterns && (await readdir(here).catch(() => [])).length > 0) return true
  const now = Date.now()
  const { scans, since } = ctx.state.sawEmpty(root.id, now)
  return scans >= EMPTY_SCANS && now - since >= EMPTY_FOR_MS
}

/**
 * Read, render and send one batch. A file is recorded as done only once cf-dam has finished it, so a
 * scan stopped part-way (paused, network gone, the agent killed) sends it again next time.
 */
async function sendBatch(ctx: Ctx, root: Root, here: string, batch: Item[], thumbsFirst = false): Promise<void> {
  const { api, state, extractor, progress } = ctx
  const abs = (rel: string) => join(here, rel)
  const failed = (item: Item, error: unknown) => {
    progress.failed++
    progress.lastError = `${item.file.path}: ${message(error)}`
    state.failed(root.id, item.file.path, { size: item.file.size, mtimeMs: item.file.mtimeMs, quickHash: item.quickHash }, message(error))
  }
  // Videos always go whole: their preview is a frame already decoded for the contact sheet.
  const preview = (item: Item, thumbOnly = thumbsFirst && !isVideo(item.file.path)) => readAndRender(ctx, root.id, abs(item.file.path), item.file, item.quickHash, thumbOnly)

  // Read and render everything except moves (their previews are usually already in cf-dam). Files
  // the agent died on last time go one at a time after the rest, so a second death is pinned on the
  // file that caused it, not on whichever others were being read alongside.
  const prepare = async (item: Item): Promise<Prepared> => {
    if (item.previous) return { item, meta: undefined, rendered: null, error: null }
    progress.current = item.file.path
    try {
      const { meta, rendered } = await preview(item)
      // A video without ffmpeg is still worth indexing (date, length, place); it just has no preview.
      const ok = rendered !== null || isVideo(item.file.path)
      return { item, meta, rendered, error: ok ? null : 'No preview could be made from this file.' }
    } catch (error) {
      return { item, meta: undefined, rendered: null, error: message(error) }
    }
  }
  const prepared = [
    ...(await inParallel(batch.filter((item) => !item.suspect), ctx.workers, prepare)),
    ...(await inParallel(batch.filter((item) => item.suspect), 1, prepare)),
  ]
  for (const p of prepared) if (p.error) failed(p.item, p.error)
  const toSend = prepared.filter((p) => !p.error)
  if (toSend.length === 0) return

  const results = await ingest(ctx, root, toSend)
  const pending: { p: Prepared; assetId: string; phash?: string; previewLater?: boolean }[] = []
  await inParallel(results, ctx.workers, async ({ r, p }) => {
    const file = p.item.file
    if (r.result === 'rejected' || !r.assetId) return failed(p.item, r.error ?? 'rejected')
    try {
      if (r.needs && r.needs.length > 0) {
        // A move whose previews went missing: render it now after all.
        const rendered = p.rendered ?? (p.item.previous ? (await preview(p.item)).rendered : null)
        if (!rendered && !isVideo(file.path)) throw new Error('No preview could be made from this file.')
        if (rendered) {
          const uploads: ['thumb' | 'preview' | 'sheet', Buffer][] = []
          for (const name of r.needs) {
            const bytes = name === 'thumb' ? rendered.thumb : rendered.preview
            if (bytes) uploads.push([name, bytes])
          }
          if (rendered.sheet) uploads.push(['sheet', rendered.sheet])
          for (const [name, bytes] of uploads) {
            await api.call('PUT', `/api/agent/assets/${r.assetId}/renditions/${name}`, undefined, { raw: new Uint8Array(bytes), contentType: 'image/webp' })
          }
        }
        pending.push({ p, assetId: r.assetId, phash: rendered?.phash, previewLater: Boolean(rendered && !rendered.preview && r.needs.includes('preview')) })
      } else if (r.result === 'unchanged' && r.ready !== false) {
        // Already in cf-dam and finished: nothing to do but remember it.
        state.done(root.id, file.path, { size: file.size, mtimeMs: file.mtimeMs, quickHash: p.item.quickHash, assetId: r.assetId })
        progress.sent++
      } else {
        pending.push({ p, assetId: r.assetId, phash: p.rendered?.phash })
      }
    } catch (error) {
      if (isLinkError(error)) throw error
      failed(p.item, error)
    }
  })
  if (pending.length === 0) return

  let finished: { id: string; status: string; error?: string }[]
  try {
    finished = (await api.call<{ results: typeof finished }>('POST', '/api/agent/assets/complete', { items: pending.map((x) => ({ id: x.assetId, phash: x.phash })) })).body.results
  } catch (error) {
    if (isLinkError(error)) throw error
    for (const x of pending) failed(x.p.item, error)
    return
  }
  const byId = new Map(finished.map((f) => [f.id, f]))
  for (const { p, assetId, previewLater } of pending) {
    const f = byId.get(assetId)
    if (f?.status !== 'ready') {
      failed(p.item, f?.error ?? 'cf-dam did not finish this photo.')
      continue
    }
    const file = p.item.file
    state.done(root.id, file.path, { size: file.size, mtimeMs: file.mtimeMs, quickHash: p.item.quickHash, assetId, previewLater })
    progress.sent++
  }
}

/** Read a file and make its previews (or its thumb only), marked as being read while it is. */
async function readAndRender(ctx: Ctx, rootId: string, abs: string, file: { path: string; size: number; mtimeMs: number }, quickHash: string, thumbOnly: boolean) {
  const { state, extractor } = ctx
  // Marked while it's being read: if the agent dies here, the next start knows which file it was on.
  state.reading(rootId, file.path, { size: file.size, mtimeMs: file.mtimeMs, quickHash })
  try {
    const x = await extractor.extract(abs)
    const rendered = x.source ? await render(x.source, x.orientation, x.ownOrientation ?? true, thumbOnly) : null
    if (rendered && x.frames) rendered.sheet = await renderSheet(x.frames)
    return { meta: x.meta, rendered }
  } finally {
    state.read(rootId, file.path)
  }
}

/**
 * The second half of thumbs first: the previews, for the folder's files sent with a thumb only. A file
 * changed or gone since is left to the next scan, which sends it whole. One whose preview can't be
 * made isn't tried again until it changes: it keeps its thumb, as a file with no preview would.
 */
async function sendPreviewsLater(ctx: Ctx, root: Root, here: string): Promise<void> {
  const { api, state, progress } = ctx
  for (;;) {
    const rows = state.previewsLater(root.id, 100)
    if (rows.length === 0 || ctx.shouldStop()) return
    await inParallel(rows, ctx.workers, async (row) => {
      if (ctx.shouldStop()) return
      const abs = join(here, row.path)
      progress.current = row.path
      try {
        const now = await stat(abs)
        if (now.size !== row.size || Math.floor(now.mtimeMs) !== row.mtime_ms || !row.asset_id) return state.previewSent(root.id, row.path)
        const { rendered } = await readAndRender(ctx, root.id, abs, { path: row.path, size: row.size, mtimeMs: row.mtime_ms }, row.quick_hash ?? '', false)
        if (rendered?.preview) {
          await api.call('PUT', `/api/agent/assets/${row.asset_id}/renditions/preview`, undefined, { raw: new Uint8Array(rendered.preview), contentType: 'image/webp' })
        }
        state.previewSent(root.id, row.path)
      } catch (error) {
        if (isLinkError(error)) throw error
        progress.lastError = `${row.path}: ${message(error)}`
        state.previewSent(root.id, row.path)
      }
    })
  }
}

/**
 * The batch's metadata to cf-dam. If cf-dam fails on the batch as a whole, the files go one at a
 * time, so one file that trips it can't hold up the rest; if every one fails too, it's cf-dam (or
 * the link), and the scan stops to try again later.
 */
async function ingest(ctx: Ctx, root: Root, toSend: Prepared[]): Promise<{ r: BatchResult; p: Prepared }[]> {
  const item = (p: Prepared) => ({
    root: root.id,
    path: p.item.file.path,
    size: p.item.file.size,
    mtime: new Date(p.item.file.mtimeMs).toISOString(),
    quickHash: p.item.quickHash,
    previousPath: p.item.previous?.path,
    previousRoot: p.item.previous?.rootId,
    metadata: p.meta,
  })
  const send = (ps: Prepared[], retries?: number) => ctx.api.call<{ results: BatchResult[] }>('POST', '/api/agent/assets/batch', { items: ps.map(item) }, { retries })
  try {
    const { body } = await send(toSend)
    return body.results.map((r, i) => ({ r, p: toSend[i]! }))
  } catch (error) {
    // Paused, unpaired, no network: stop now.
    if (!(error instanceof ApiError)) throw error
    const out: { r: BatchResult; p: Prepared }[] = []
    let accepted = 0
    for (const p of toSend) {
      if (ctx.shouldStop()) throw error
      try {
        const { body } = await send([p], 1)
        out.push({ r: body.results[0]!, p })
        accepted++
      } catch (one) {
        if (!(one instanceof ApiError)) throw one
        out.push({ r: { path: p.item.file.path, result: 'rejected', error: one.message }, p })
      }
    }
    if (accepted === 0 && toSend.length > 1 && isLinkError(error)) throw error
    return out
  }
}
