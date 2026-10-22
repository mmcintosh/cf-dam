/** Settings from the environment. In Docker these come from the compose file Synology runs. */
import { existsSync } from 'node:fs'
import { availableParallelism, homedir, hostname, totalmem } from 'node:os'
import { delimiter, join } from 'node:path'

export const VERSION = '0.1.0'

export interface AgentConfig {
  /** Where cf-dam runs, e.g. https://dam.example.com */
  url: string
  /** State and credentials (a volume, so they survive container updates). */
  dataDir: string
  /** Docker: where the photo folders are mounted, read-only. On a desktop, null: folders are anywhere. */
  photosDir: string | null
  /** The status page. */
  port: number
  /** Where the status page listens: every interface in Docker (the NAS's port mapping), else this computer only. */
  host: string
  /** Photos processed at once. Each takes ~400 MB at peak (spike 5a), so memory sets the ceiling too. */
  workers: number
  /** Shown in cf-dam when pairing. */
  name: string
  /** Desktops: folders to offer besides drives, shares and Pictures (AGENT_FOLDERS, ';' or ':' separated as PATH is). */
  extraFolders: string[]
  /** Tests: send thumbs first above this many photos instead of pipeline.ts's THUMBS_FIRST. */
  thumbsFirstOver?: number
}

const MIB = 1024 * 1024

/**
 * The memory the agent may use: a container's limit when it has one (Docker's mem_limit), else the
 * machine's. Inside a container the machine's total is the host's (15 GB seen under a 1 GB limit).
 */
export function memoryLimit(): number {
  const constrained = process.constrainedMemory()
  return constrained > 0 && constrained < totalmem() ? constrained : totalmem()
}

/**
 * Photos at once, each on one core (sharp runs one libvips thread a photo). A NAS shares a few slow
 * cores with everything else it does: three at most. A Mac or PC has more, but someone is using it:
 * up to eight, leaving a core free and using at most half its memory.
 */
export function defaultWorkers(docker: boolean, cores = availableParallelism(), memory = memoryLimit()): number {
  // ~250 MB for Node, ExifTool and a batch in flight; ~600 MB for each photo being read.
  const byMemory = Math.max(1, Math.floor(((docker ? memory : memory / 2) - 250 * MIB) / (600 * MIB)))
  const byCpu = Math.max(1, cores - 1)
  return Math.min(docker ? 3 : 8, byCpu, byMemory)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const url = env.CF_DAM_URL?.replace(/\/+$/, '')
  if (!url || !/^https?:\/\//.test(url)) throw new Error('Set CF_DAM_URL to your cf-dam address, e.g. https://dam.example.com')
  // In Docker (a NAS) photos are mounted under /photos and state lives in /data. On a Mac or PC the
  // agent runs as the person, with state in their application-data folder.
  const docker = Boolean(env.PHOTOS_DIR) || existsSync('/photos')
  const workers = Number(env.WORKERS) > 0 ? Math.floor(Number(env.WORKERS)) : defaultWorkers(docker)
  const appData =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'cf-dam-agent')
      : process.platform === 'win32'
        ? join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'cf-dam-agent')
        : join(homedir(), '.cf-dam-agent')
  return {
    url,
    dataDir: env.DATA_DIR ?? (docker ? '/data' : appData),
    photosDir: docker ? (env.PHOTOS_DIR ?? '/photos') : null,
    port: Number(env.PORT) > 0 ? Number(env.PORT) : 8790,
    host: env.STATUS_HOST?.trim() || (docker ? '0.0.0.0' : '127.0.0.1'),
    workers,
    name: env.AGENT_NAME?.trim() || hostname(),
    extraFolders: (env.AGENT_FOLDERS ?? '').split(delimiter).map((f) => f.trim()).filter(Boolean),
  }
}
