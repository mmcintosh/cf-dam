/**
 * The cf-dam NAS agent. Pairs once (a code you type into cf-dam), then indexes the folders chosen
 * in cf-dam: every 15 minutes, or at once when asked. Reads photos; never changes, moves or deletes them.
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Api, Paused, Unpaired } from './api.ts'
import { loadConfig, VERSION, type AgentConfig } from './config.ts'
import { Extractor } from './extract.ts'
import { newProgress, scanRoot, type Root } from './pipeline.ts'
import { State } from './state.ts'
import { serveStatus, type StatusView } from './status.ts'
import { listVolumes, locate, toAgentPath, type Volume } from './volumes.ts'
import { homedir } from 'node:os'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args)

interface Config {
  source: { id: string; name: string; paused: boolean }
  roots: Root[]
  scanIntervalMinutes: number
  defaultExcludes: string[]
}

export class Agent {
  readonly state: State
  readonly api: Api
  readonly extractor: Extractor
  private stopping = false
  private paused = false
  private rescan = true
  private scanIntervalMs = 15 * 60_000
  private view: StatusView

  constructor(
    readonly config: AgentConfig,
    api?: Api,
    /** Where drives come from: the OS normally; tests stand in their own. */
    private readonly volumeLister: () => Promise<Volume[]> = listVolumes,
  ) {
    this.state = new State(config.dataDir)
    this.api = api ?? new Api(config.url)
    this.extractor = new Extractor(config.workers)
    this.view = { name: config.name, version: VERSION, url: config.url, phase: 'starting', pairingCode: null, progress: newProgress(), done: 0, failed: 0, lastScanAt: null, message: null }
  }

  status = (): StatusView => {
    const counts = this.state.counts()
    return { ...this.view, done: counts.done, failed: counts.error }
  }

  stop(): void {
    this.stopping = true
  }

  /** Pair with cf-dam if this agent has no key yet. */
  async pair(): Promise<void> {
    const saved = this.state.credentials(this.config.url)
    if (saved) {
      this.api.apiKey = saved.apiKey
      return
    }
    this.api.apiKey = null
    while (!this.stopping) {
      const start = await this.api.call<{ deviceCode: string; userCode: string; interval: number; expiresIn: number; verificationUrl: string }>('POST', '/api/agent/pair/start', {
        name: this.config.name,
        platform: `${process.platform}/${process.arch}`,
        version: VERSION,
      })
      const { deviceCode, userCode, interval, verificationUrl } = start.body
      this.view.phase = 'pairing'
      this.view.pairingCode = userCode
      log(`To connect this agent, open ${verificationUrl} and enter the code ${userCode}`)
      for (;;) {
        if (this.stopping) return
        await sleep(interval * 1000)
        const poll = await this.api.call<{ status: string; apiKey?: string; sourceId?: string }>('POST', '/api/agent/pair/poll', { deviceCode })
        if (poll.body.status === 'approved' && poll.body.apiKey && poll.body.sourceId) {
          this.state.saveCredentials({ url: this.config.url, apiKey: poll.body.apiKey, sourceId: poll.body.sourceId })
          this.api.apiKey = poll.body.apiKey
          this.view.pairingCode = null
          log('Paired. Choose folders to index in cf-dam.')
          return
        }
        if (poll.status === 410) break // expired: start again with a fresh code
      }
    }
  }

  /** Tell cf-dam we're alive and what we're doing; learn whether to pause or rescan. */
  async heartbeat(): Promise<void> {
    const res = await this.api.call<{ paused: boolean; rescan: boolean }>('POST', '/api/agent/heartbeat', {
      version: VERSION,
      platform: `${process.platform}/${process.arch}`,
      status: { phase: this.view.phase, ...this.view.progress, ...this.state.counts() },
    })
    this.paused = res.body.paused
    if (res.body.rescan) this.rescan = true
  }

  private volumes: Volume[] = []

  /**
   * The folders cf-dam can offer. In Docker: everything mounted under the photos folder, two levels
   * down. On a Mac or PC: each drive and mounted share (and its folders), and the Pictures folder.
   */
  async reportFolders(): Promise<void> {
    this.volumes = await this.volumeLister().catch(() => [])
    const folders: string[] = []
    const list = (dir: string, depth: number) => {
      let names: string[] = []
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      for (const name of names) {
        if (name.startsWith('.') || name.startsWith('@') || name.startsWith('#')) continue
        const path = join(dir, name)
        try {
          if (!statSync(path).isDirectory()) continue
        } catch {
          continue
        }
        folders.push(path)
        if (depth < 2) list(path, depth + 1)
      }
    }
    if (this.config.photosDir) list(this.config.photosDir, 1)
    else {
      for (const v of this.volumes) {
        folders.push(v.path)
        list(v.path, 2)
      }
      folders.push(join(homedir(), 'Pictures'))
    }
    await this.api.call('POST', '/api/agent/folders', {
      folders: [...new Set(folders.map(toAgentPath))].slice(0, 500),
      volumes: this.volumes,
    })
  }

  /** One pass over every enabled folder. */
  async scanAll(): Promise<void> {
    this.volumes = await this.volumeLister().catch(() => this.volumes)
    const { body: config } = await this.api.call<Config>('GET', '/api/agent/config')
    this.scanIntervalMs = Math.max(1, config.scanIntervalMinutes) * 60_000
    this.state.keepRoots(config.roots.map((r) => r.id))
    if (config.source.paused) {
      this.paused = true
      return
    }
    this.view.phase = 'scanning'
    this.view.progress = newProgress()
    for (const root of config.roots) {
      if (this.stopping || this.paused) break
      log(`Scanning ${root.path}`)
      await scanRoot(
        {
          api: this.api,
          state: this.state,
          extractor: this.extractor,
          workers: this.config.workers,
          defaultExcludes: config.defaultExcludes,
          progress: this.view.progress,
          shouldStop: () => this.stopping || this.paused,
        },
        root,
        locate(root, this.volumes),
      )
      const p = this.view.progress
      log(`Done ${root.path}: ${p.found} found, ${p.sent} sent, ${p.failed} failed, ${p.missing} missing`)
    }
    this.view.lastScanAt = new Date().toISOString()
    this.view.phase = 'idle'
  }

  async run(): Promise<void> {
    serveStatus(this.config.port, this.status)
    log(`cf-dam agent ${VERSION} for ${this.config.url}, ${this.config.workers} at a time; status on port ${this.config.port}`)
    while (!this.stopping) {
      try {
        await this.pair()
        await this.reportFolders()
        let lastScan = 0
        let lastFolders = Date.now()
        while (!this.stopping) {
          await this.heartbeat()
          // A drive plugged in or out (or a share mounted): tell cf-dam, and scan at once.
          const volumes = await this.volumeLister().catch(() => this.volumes)
          const changed = volumes.map((v) => `${v.id}@${v.path}`).sort().join('|') !== this.volumes.map((v) => `${v.id}@${v.path}`).sort().join('|')
          if (changed || Date.now() - lastFolders > 3_600_000) {
            await this.reportFolders()
            lastFolders = Date.now()
            if (changed) this.rescan = true
          }
          if (this.paused) {
            this.view.phase = 'paused'
          } else if (this.rescan || Date.now() - lastScan > this.scanIntervalMs) {
            this.rescan = false
            await this.scanAll()
            lastScan = Date.now()
          } else {
            this.view.phase = 'idle'
          }
          await sleep(60_000)
        }
      } catch (error) {
        if (error instanceof Unpaired) {
          log('cf-dam revoked this agent. Pairing again.')
          this.state.clearCredentials()
          continue
        }
        if (error instanceof Paused) {
          this.paused = true
          continue
        }
        this.view.phase = 'error'
        this.view.message = error instanceof Error ? error.message : String(error)
        log('Error:', this.view.message, '— retrying in a minute')
        await sleep(60_000)
      }
    }
    await this.extractor.end()
  }
}

// Started as a program (not imported by tests).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('agent.mjs')) {
  const agent = new Agent(loadConfig())
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log('Stopping…')
      agent.stop()
      setTimeout(() => process.exit(0), 5_000).unref()
    })
  }
  void agent.run()
}
