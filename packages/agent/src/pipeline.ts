/**
 * One scan of one folder: walk it, work out what changed, send new and changed photos in batches
 * (metadata first; previews only for what cf-dam asks for), then report what's gone.
 */
import { join } from 'node:path'
import { ApiError, type Api } from './api.ts'
import type { Extractor } from './extract.ts'
import { render, type Rendered } from './render.ts'
import { plan, quickHash, walk, type Found } from './scan.ts'
import type { FileRow, State } from './state.ts'

export interface Root {
  id: string
  path: string
  include: string[]
  exclude: string[]
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
}

export const newProgress = (): Progress => ({ root: null, current: null, found: 0, queued: 0, sent: 0, failed: 0, missing: 0, startedAt: null, lastError: null })

interface Ctx {
  api: Api
  state: State
  extractor: Extractor
  workers: number
  defaultExcludes: string[]
  progress: Progress
  /** Checked between batches, so pausing or shutting down takes effect within a batch. */
  shouldStop: () => boolean
}

/** Photos per request. Small enough that previews for a batch fit comfortably in memory. */
const BATCH = 20

interface Item {
  file: Found
  quickHash: string
  previousPath?: string
}

interface BatchResult {
  path: string
  assetId?: string
  result: 'created' | 'updated' | 'unchanged' | 'moved' | 'rejected'
  needs?: ('thumb' | 'preview')[]
  error?: string
}

async function inParallel<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!)
      }
    }),
  )
  return out
}

export async function scanRoot(ctx: Ctx, root: Root): Promise<void> {
  const { api, state, progress } = ctx
  const abs = (rel: string) => join(root.path, rel)
  progress.root = root.path
  progress.startedAt = new Date().toISOString()

  const found = await walk(root.path, [...ctx.defaultExcludes, ...root.exclude], root.include)
  const known = state.files(root.id)
  const { work, gone } = plan(found, known)
  progress.found = found.size
  progress.queued = work.length

  // Fingerprint the work, then pair new files with gone ones: the same fingerprint is a move or rename.
  const items: Item[] = []
  const goneByHash = new Map<string, FileRow>()
  for (const g of gone) if (g.quick_hash && g.status === 'done') goneByHash.set(g.quick_hash, g)
  for (const { file, known: row } of work) {
    if (ctx.shouldStop()) return
    try {
      const qh = await quickHash(abs(file.path), file.size)
      const was = !row ? goneByHash.get(qh) : undefined
      if (was) goneByHash.delete(qh)
      items.push({ file, quickHash: qh, previousPath: was?.path })
    } catch (error) {
      progress.failed++
      state.failed(root.id, file.path, { size: file.size, mtimeMs: file.mtimeMs, quickHash: null }, String(error))
    }
  }
  const moved = new Set(items.filter((i) => i.previousPath).map((i) => i.previousPath!))

  for (let i = 0; i < items.length; i += BATCH) {
    if (ctx.shouldStop()) return
    await sendBatch(ctx, root, items.slice(i, i + BATCH))
  }

  // Report what's gone (moves were reported as moves), in chunks, then forget it locally.
  const missing = gone.filter((g) => !moved.has(g.path)).map((g) => g.path)
  for (let i = 0; i === 0 || i < missing.length; i += 5000) {
    const chunk = missing.slice(i, i + 5000)
    const last = i + 5000 >= missing.length
    const res = await api.call<{ missing: number }>('POST', '/api/agent/scans/complete', { root: root.id, missing: chunk, final: last })
    progress.missing += res.body.missing
  }
  state.forget(root.id, [...missing, ...moved])
  progress.current = null
}

async function sendBatch(ctx: Ctx, root: Root, batch: Item[]): Promise<void> {
  const { api, state, extractor, progress } = ctx
  const abs = (rel: string) => join(root.path, rel)

  // Read and render everything except moves (their previews are usually already in cf-dam).
  const prepared = await inParallel(batch, ctx.workers, async (item) => {
    if (item.previousPath) return { item, meta: undefined, rendered: null as Rendered | null, error: null as string | null }
    progress.current = item.file.path
    try {
      const x = await extractor.extract(abs(item.file.path))
      const rendered = x.source ? await render(x.source, x.orientation) : null
      return { item, meta: x.meta, rendered, error: rendered ? null : 'No preview could be made from this file.' }
    } catch (error) {
      return { item, meta: undefined, rendered: null, error: error instanceof Error ? error.message : String(error) }
    }
  })

  const toSend = prepared.filter((p) => !p.error)
  for (const p of prepared.filter((p) => p.error)) {
    progress.failed++
    progress.lastError = `${p.item.file.path}: ${p.error}`
    state.failed(root.id, p.item.file.path, { size: p.item.file.size, mtimeMs: p.item.file.mtimeMs, quickHash: p.item.quickHash }, p.error!)
  }
  if (toSend.length === 0) return

  const { body } = await api.call<{ results: BatchResult[] }>('POST', '/api/agent/assets/batch', {
    items: toSend.map((p) => ({
      root: root.id,
      path: p.item.file.path,
      size: p.item.file.size,
      mtime: new Date(p.item.file.mtimeMs).toISOString(),
      quickHash: p.item.quickHash,
      previousPath: p.item.previousPath,
      metadata: p.meta,
    })),
  })

  const complete: { id: string; phash?: string }[] = []
  await inParallel(body.results.map((r, i) => ({ r, p: toSend[i]! })), ctx.workers, async ({ r, p }) => {
    const file = p.item.file
    if (r.result === 'rejected' || !r.assetId) {
      progress.failed++
      progress.lastError = `${file.path}: ${r.error ?? 'rejected'}`
      state.failed(root.id, file.path, { size: file.size, mtimeMs: file.mtimeMs, quickHash: p.item.quickHash }, r.error ?? 'rejected')
      return
    }
    try {
      if (r.needs && r.needs.length > 0) {
        // A move whose previews went missing: render it now after all.
        let rendered = p.rendered
        if (!rendered) {
          const x = await extractor.extract(abs(file.path))
          rendered = x.source ? await render(x.source, x.orientation) : null
        }
        if (!rendered) throw new Error('No preview could be made from this file.')
        for (const name of r.needs) {
          await api.call('PUT', `/api/agent/assets/${r.assetId}/renditions/${name}`, undefined, {
            raw: new Uint8Array(name === 'thumb' ? rendered.thumb : rendered.preview),
            contentType: 'image/webp',
          })
        }
        complete.push({ id: r.assetId, phash: rendered.phash })
      } else if (r.result !== 'unchanged') {
        complete.push({ id: r.assetId, phash: p.rendered?.phash })
      }
      state.done(root.id, file.path, { size: file.size, mtimeMs: file.mtimeMs, quickHash: p.item.quickHash, assetId: r.assetId })
      progress.sent++
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      progress.failed++
      progress.lastError = `${file.path}: ${error.message}`
      state.failed(root.id, file.path, { size: file.size, mtimeMs: file.mtimeMs, quickHash: p.item.quickHash }, error.message)
    }
  })
  if (complete.length > 0) await api.call('POST', '/api/agent/assets/complete', { items: complete })
}
