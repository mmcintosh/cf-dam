/** Walking a folder: which files to index, and what changed since last time. */
import { createHash } from 'node:crypto'
import { open, opendir, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import type { FileRow } from './state.ts'

export const PHOTO_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic', '.heif', '.webp', '.avif', '.gif',
  '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.dng', '.raf', '.orf', '.rw2', '.pef',
  '.srw', '.3fr', '.iiq', '.rwl', '.x3f', '.erf', '.kdc', '.mos', '.mrw',
])

/** A glob ('*.lrdata', '@eaDir', 'Exports/**') as a RegExp over a name or a relative path. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

/**
 * Which folders to skip and files to keep. A pattern without '/' matches any single name on the path
 * ('@eaDir' anywhere); one with '/' matches the whole relative path ('Exports/**').
 */
export function matcher(exclude: string[], include: string[] = []) {
  const compile = (globs: string[]) => globs.map((g) => ({ re: globToRegExp(g), whole: g.includes('/') }))
  const ex = compile(exclude)
  const inc = compile(include)
  const hits = (patterns: ReturnType<typeof compile>, rel: string) => {
    const names = rel.split('/')
    return patterns.some((p) => (p.whole ? p.re.test(rel) : names.some((n) => p.re.test(n))))
  }
  return {
    skipDir: (rel: string) => hits(ex, rel),
    keepFile: (rel: string) => !hits(ex, rel) && (inc.length === 0 || hits(inc, rel)),
  }
}

export interface Found {
  path: string
  size: number
  mtimeMs: number
}

/** Every photo under `root` (relative paths with '/'), skipping excluded folders and files. Symlinks are not followed. */
export async function walk(root: string, exclude: string[], include: string[] = []): Promise<Map<string, Found>> {
  const match = matcher(exclude, include)
  const found = new Map<string, Found>()
  const visit = async (dir: string): Promise<void> => {
    let handle
    try {
      handle = await opendir(dir)
    } catch {
      return // unreadable folder: skip it, don't stop the scan
    }
    for await (const entry of handle) {
      const abs = join(dir, entry.name)
      const rel = relative(root, abs).split(sep).join('/')
      if (entry.isDirectory()) {
        if (!match.skipDir(rel)) await visit(abs)
      } else if (entry.isFile() && PHOTO_EXTENSIONS.has(extname(entry.name).toLowerCase()) && match.keepFile(rel)) {
        try {
          const s = await stat(abs)
          found.set(rel, { path: rel, size: s.size, mtimeMs: Math.floor(s.mtimeMs) })
        } catch {
          // vanished between listing and stat
        }
      }
    }
  }
  await visit(root)
  return found
}

export interface Plan {
  /** New or changed files, each with where it used to be if it looks like a move. */
  work: { file: Found; known: FileRow | undefined }[]
  /** Files known before and not found now. */
  gone: FileRow[]
}

/**
 * Compare what's on disk with what was sent. Unchanged and done: nothing to do. Changed size or
 * mtime, new, or failed fewer than three times: work. Known but not found: gone.
 */
export function plan(found: Map<string, Found>, known: Map<string, FileRow>): Plan {
  const work: Plan['work'] = []
  for (const file of found.values()) {
    const row = known.get(file.path)
    const same = row && row.size === file.size && row.mtime_ms === file.mtimeMs
    if (same && row.status === 'done') continue
    if (same && row.status === 'error' && row.attempts >= 3) continue
    work.push({ file, known: row })
  }
  const gone = [...known.values()].filter((r) => !found.has(r.path))
  return { work, gone }
}

const MIB = 1024 * 1024

/**
 * The quick fingerprint: SHA-256 over the size, the first MiB and the last MiB. Recognises a file
 * after a move or rename without reading all of a 60 MB RAW over a NAS's disks.
 */
export async function quickHash(path: string, size: number): Promise<string> {
  const hash = createHash('sha256').update(`cf-dam-qh1:${size}:`)
  const handle = await open(path, 'r')
  try {
    const head = Buffer.alloc(Math.min(MIB, size))
    await handle.read(head, 0, head.length, 0)
    hash.update(head)
    if (size > MIB) {
      const tail = Buffer.alloc(Math.min(MIB, size - MIB))
      await handle.read(tail, 0, tail.length, size - tail.length)
      hash.update(tail)
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}
