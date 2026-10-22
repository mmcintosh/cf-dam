import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_IMAGE_TAG } from '../../api/src/routes/sources.ts'
import { defaultWorkers, loadConfig, memoryLimit, VERSION } from '../src/config.ts'
import { plan } from '../src/scan.ts'
import { State, STOPPED_READING } from '../src/state.ts'
import { serveStatus } from '../src/status.ts'

const dirs: string[] = []
const dataDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-state-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const file = { path: 'a/IMG_1.tif', size: 270_000_000, mtimeMs: 1_700_000_000_000 }

describe('a file the agent dies reading', () => {
  it('counts as a failed try at the next start, and is given up on after three', () => {
    const dir = dataDir()
    for (let run = 1; run <= 3; run++) {
      const state = new State(dir)
      // The scan plans it while it has tries left…
      expect(plan(new Map([[file.path, file]]), state.files('r1')).work).toHaveLength(1)
      state.reading('r1', file.path, { ...file, quickHash: 'qh' })
      state.db.close() // …and the agent is killed mid-read.
    }
    const state = new State(dir)
    const row = state.files('r1').get(file.path)!
    expect(row).toMatchObject({ status: 'error', error: STOPPED_READING, attempts: 3, quick_hash: 'qh' })
    expect(plan(new Map([[file.path, file]]), state.files('r1')).work).toHaveLength(0)
    // A new version of the agent tries it again; the same version doesn't.
    state.newVersion('9.9.9')
    expect(state.files('r1').get(file.path)!.attempts).toBe(0)
    state.failed('r1', file.path, { ...file, quickHash: 'qh' }, 'still bad')
    state.newVersion('9.9.9')
    expect(state.files('r1').get(file.path)!.attempts).toBe(1)
  })

  it('isn’t blamed when it was read to the end, or when the agent was stopped on purpose', () => {
    const dir = dataDir()
    let state = new State(dir)
    state.reading('r1', file.path, { ...file, quickHash: 'qh' })
    state.read('r1', file.path)
    state.reading('r1', 'b.jpg', { ...file, quickHash: 'qh2' })
    state.clearReading()
    state.db.close()
    state = new State(dir)
    expect(state.files('r1').size).toBe(0)
  })
})

describe('memory', () => {
  it('sizes workers by the container’s limit, not the host’s memory', () => {
    const gib = 1024 ** 3
    vi.spyOn(process, 'constrainedMemory').mockReturnValue(1 * gib)
    expect(memoryLimit()).toBe(gib)
    expect(loadConfig({ CF_DAM_URL: 'https://dam.example.com' }).workers).toBe(1)
    // No limit: Node reports a huge number (or 0), and the machine's memory counts.
    vi.spyOn(process, 'constrainedMemory').mockReturnValue(2 ** 64)
    expect(memoryLimit()).toBeLessThan(2 ** 50)
    expect(loadConfig({ CF_DAM_URL: 'https://dam.example.com', WORKERS: '5' }).workers).toBe(5)
  })

  it('lets a Mac or PC work on more photos at once than a NAS, within half its memory', () => {
    const gib = 1024 ** 3
    expect(defaultWorkers(true, 10, 16 * gib)).toBe(3)
    expect(defaultWorkers(false, 10, 16 * gib)).toBe(8)
    expect(defaultWorkers(false, 10, 8 * gib)).toBe(6)
    expect(defaultWorkers(false, 4, 16 * gib)).toBe(3)
    expect(defaultWorkers(false, 2, 2 * gib)).toBe(1)
  })
})

describe('the status page', () => {
  const servers: { close: () => unknown }[] = []
  afterEach(() => {
    for (const s of servers.splice(0)) s.close()
  })
  const listening = (s: Server) => new Promise<void>((resolve) => (s.listening ? resolve() : s.once('listening', () => resolve())))

  it('listens on this computer only unless told otherwise, and survives its port being taken', async () => {
    const view = () => ({ name: 'x', version: '0', url: 'https://dam.example.com', phase: 'idle' as const, pairingCode: null, progress: {} as never, done: 0, failed: 0, previewsLater: 0, lastScanAt: null, message: null })
    const status = serveStatus(0, '127.0.0.1', view)
    servers.push(status)
    await listening(status)
    const address = status.address() as { address: string; port: number }
    expect(address.address).toBe('127.0.0.1')
    // A second one on the same port: logged, not thrown (a crash here was a launchd restart loop).
    const log = vi.fn()
    const second = serveStatus(address.port, '127.0.0.1', view, log)
    servers.push(second)
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('EADDRINUSE')))
    expect(second.listening).toBe(false)
    expect(loadConfig({ CF_DAM_URL: 'https://dam.example.com', PHOTOS_DIR: '/photos' }).host).toBe('0.0.0.0')
    expect(loadConfig({ CF_DAM_URL: 'https://dam.example.com', DATA_DIR: dataDir() }).host).toBe(existsSync('/photos') ? '0.0.0.0' : '127.0.0.1')
  })
})

describe('the image tag', () => {
  it('is one the release publishes for this version, in both compose files', () => {
    // agent-v0.1.0 publishes 0.1.0 and 0.1; from 1.0, the major too (.github/workflows/agent.yml).
    const [major, minor] = VERSION.split('.')
    expect(AGENT_IMAGE_TAG).toBe(major === '0' ? `0.${minor}` : major)
    const example = readFileSync(new URL('../docker/compose.example.yaml', import.meta.url), 'utf8')
    expect(example).toContain(`image: ghcr.io/mmcintosh/cf-dam-agent:${AGENT_IMAGE_TAG}\n`)
  })
})
