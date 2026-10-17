/** Settings from the environment. In Docker these come from the compose file Synology runs. */
import { existsSync } from 'node:fs'
import { availableParallelism, homedir, hostname, totalmem } from 'node:os'
import { join } from 'node:path'

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
  /** Photos processed at once. Each takes ~400 MB at peak (spike 5a), so memory sets the ceiling too. */
  workers: number
  /** Shown in cf-dam when pairing. */
  name: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const url = env.CF_DAM_URL?.replace(/\/+$/, '')
  if (!url || !/^https?:\/\//.test(url)) throw new Error('Set CF_DAM_URL to your cf-dam address, e.g. https://dam.example.com')
  const byMemory = Math.max(1, Math.floor(totalmem() / (600 * 1024 * 1024)))
  const byCpu = Math.max(1, availableParallelism() - 1)
  const workers = Number(env.WORKERS) > 0 ? Math.floor(Number(env.WORKERS)) : Math.min(3, byCpu, byMemory)
  // In Docker (a NAS) photos are mounted under /photos and state lives in /data. On a Mac or PC the
  // agent runs as the person, with state in their application-data folder.
  const docker = Boolean(env.PHOTOS_DIR) || existsSync('/photos')
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
    workers,
    name: env.AGENT_NAME?.trim() || hostname(),
  }
}
