/** Walking a folder: which files to index, and what changed since last time. */
import { createHash } from 'node:crypto'
import { open, opendir, stat } from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'
import { MAX_SCAN_ATTEMPTS, type FileRow } from './state.ts'

export const PHOTO_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic', '.heif', '.webp', '.avif', '.gif',
  '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.dng', '.raf', '.orf', '.rw2', '.pef',
  '.srw', '.3fr', '.iiq', '.rwl', '.x3f', '.erf', '.kdc', '.mos', '.mrw',
])
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.mts', '.m2ts', '.avi', '.mkv', '.3gp', '.webm'])
export const isVideo = (path: string) => VIDEO_EXTENSIONS.has(extname(path).toLowerCase())

/** Formats Lightroom writes metadata into: an IMG_1234.xmp beside one of these belongs to a RAW of the same name. */
const WRITES_INTO = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic', '.heif', '.webp', '.avif', '.gif', '.dng'])

/**
 * A photo's XMP sidecar among the names in its folder (lower-cased → as on disk). Lightroom, Bridge and
 * Camera Raw name it after the RAW without its extension (IMG_1234.xmp); darktable, Capture One and others
 * keep the extension (IMG_1234.CR2.xmp), which is unambiguous and so comes first.
 */
export function sidecarOf(name: string, xmps: Map<string, string>): string | undefined {
  const lower = name.toLowerCase()
  const ext = extname(lower)
  const whole = xmps.get(`${lower}.xmp`)
  if (whole || WRITES_INTO.has(ext) || VIDEO_EXTENSIONS.has(ext)) return whole
  return xmps.get(`${lower.slice(0, lower.length - ext.length)}.xmp`)
}

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
  /** Its XMP sidecar (relative, like path), if it has one. */
  sidecar?: string
}

export interface Walked {
  found: Map<string, Found>
  /** Folders that couldn't be read, or not to the end (relative; '' is the root). Files known under them aren't gone. */
  unreadable: string[]
  /** Of those, the ones the system refused outright (macOS without Full Disk Access, say). */
  denied: string[]
}

/** Every photo under `root` (relative paths with '/'), skipping excluded folders and files. Symlinks are not followed. */
export async function walk(root: string, exclude: string[], include: string[] = []): Promise<Walked> {
  const match = matcher(exclude, include)
  const found = new Map<string, Found>()
  const unreadable: string[] = []
  const denied: string[] = []
  const visit = async (dir: string): Promise<void> => {
    const relDir = relative(root, dir).split(sep).join('/')
    const photos: Found[] = []
    const xmps = new Map<string, string>()
    try {
      // A share that drops mid-listing throws here or part-way through; either way, don't stop the scan.
      for await (const entry of await opendir(dir)) {
        const abs = join(dir, entry.name)
        const rel = relative(root, abs).split(sep).join('/')
        if (entry.isDirectory()) {
          if (!match.skipDir(rel)) await visit(abs)
        } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.xmp') {
          xmps.set(entry.name.toLowerCase(), entry.name)
        } else if (entry.isFile() && (PHOTO_EXTENSIONS.has(extname(entry.name).toLowerCase()) || isVideo(entry.name)) && match.keepFile(rel)) {
          try {
            const s = await stat(abs)
            const photo: Found = { path: rel, size: s.size, mtimeMs: Math.floor(s.mtimeMs) }
            found.set(rel, photo)
            photos.push(photo)
          } catch (error) {
            // Vanished between listing and stat is fine; anything else, the file may well still be there.
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadable.push(rel)
          }
        }
      }
    } catch (error) {
      unreadable.push(relDir)
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES') denied.push(relDir)
    }
    // Once the folder is listed: a sidecar can come before or after its photo.
    for (const photo of photos) {
      const side = sidecarOf(basename(photo.path), xmps)
      if (side) photo.sidecar = relDir ? `${relDir}/${side}` : side
    }
  }
  await visit(root)
  return { found, unreadable, denied }
}

export interface Plan {
  /** New or changed files, each with where it used to be if it looks like a move. */
  work: { file: Found; known: FileRow | undefined }[]
  /** Files known before and not found now (and not under a folder that couldn't be read). */
  gone: FileRow[]
}

/**
 * Compare what's on disk with what was sent. Unchanged and done: nothing to do. Changed size or
 * mtime, new, or failed fewer than three times: work. Known but not found: gone.
 */
export function plan(found: Map<string, Found>, known: Map<string, FileRow>, unreadable: string[] = []): Plan {
  const work: Plan['work'] = []
  for (const file of found.values()) {
    const row = known.get(file.path)
    const same = row && row.size === file.size && row.mtime_ms === file.mtimeMs
    if (same && row.status === 'done') continue
    if (same && row.status === 'error' && row.attempts >= MAX_SCAN_ATTEMPTS) continue
    work.push({ file, known: row })
  }
  const shaded = (path: string) => unreadable.some((d) => d === '' || path === d || path.startsWith(`${d}/`))
  const gone = [...known.values()].filter((r) => !found.has(r.path) && !shaded(r.path))
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
