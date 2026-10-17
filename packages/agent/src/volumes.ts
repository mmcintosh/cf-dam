/**
 * Drives and shares the agent can see, with a stable id, so a folder on a USB drive is found again
 * when the drive comes back at another mount point (macOS) or drive letter (Windows).
 *
 * Paths are reported the way cf-dam stores them, with forward slashes: '/Volumes/Archive 2014-B',
 * 'E:/', '//nas/photo'.
 */
import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface Volume {
  id: string
  label: string | null
  path: string
  removable: boolean
}

/** 'E:\\Photos' → 'E:/Photos'; '\\\\nas\\photo' → '//nas/photo'. */
export const toAgentPath = (p: string) => p.replace(/\\/g, '/').replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`)

/** Pull `<key>Name</key><string|true|false…>` pairs out of a plist (diskutil's output), flat. */
function plist(xml: string): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  const re = /<key>([^<]+)<\/key>\s*(?:<string>([^<]*)<\/string>|<(true|false)\/>)/g
  for (let m = re.exec(xml); m; m = re.exec(xml)) out[m[1]!] = m[2] !== undefined ? m[2] : m[3] === 'true'
  return out
}

async function macVolumes(): Promise<Volume[]> {
  const volumes: Volume[] = []
  let names: string[] = []
  try {
    names = readdirSync('/Volumes')
  } catch {
    return volumes
  }
  for (const name of names) {
    const path = join('/Volumes', name)
    const info = await run('diskutil', ['info', '-plist', path]).then((r) => plist(r.stdout)).catch(() => null)
    if (info?.VolumeUUID) {
      volumes.push({ id: `uuid:${info.VolumeUUID}`, label: (info.VolumeName as string) || name, path, removable: info.Internal === false || info.Ejectable === true })
    } else {
      // A network share (no disk behind it): known by where it comes from.
      const mount = await run('mount').then((r) => r.stdout.split('\n').find((l) => l.includes(` on ${path} (`))).catch(() => undefined)
      const from = mount?.split(' on ')[0]?.replace(/^\/\/[^@]*@/, '//')
      volumes.push({ id: from ? `share:${from}` : `mount:${path}`, label: name, path, removable: true })
    }
  }
  return volumes
}

async function windowsVolumes(): Promise<Volume[]> {
  const script =
    'Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter,FileSystemLabel,UniqueId,DriveType | ConvertTo-Json -Compress'
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]).then((r) => r.stdout.trim()).catch(() => '')
  if (!out) return []
  const rows = ([] as { DriveLetter: string; FileSystemLabel: string | null; UniqueId: string; DriveType: string }[]).concat(JSON.parse(out))
  return rows.map((v) => ({
    id: `volume:${v.UniqueId}`,
    label: v.FileSystemLabel || `${v.DriveLetter}:`,
    path: `${v.DriveLetter.toUpperCase()}:/`,
    removable: v.DriveType !== 'Fixed',
  }))
}

/** Volumes on this machine. In Docker (a NAS) there are none to track: the shares are mounted for good. */
export async function listVolumes(): Promise<Volume[]> {
  if (process.platform === 'darwin') return macVolumes()
  if (process.platform === 'win32') return windowsVolumes()
  return []
}

/**
 * Where a folder is right now. A folder on a tracked volume moves with it: the part of its path
 * below the volume is kept, the volume's current mount point is put in front.
 */
export function locate(root: { path: string; volume: { id: string; path: string | null } | null }, volumes: Volume[]): string {
  if (!root.volume?.path) return root.path
  const now = volumes.find((v) => v.id === root.volume!.id)
  if (!now) return root.path
  const below = root.path.slice(root.volume.path.length).replace(/^\/+/, '')
  const base = now.path.endsWith('/') ? now.path : `${now.path}/`
  return below ? `${base}${below}` : now.path
}
