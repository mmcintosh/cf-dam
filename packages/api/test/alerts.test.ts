import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alertCount, alertsDue, checkAlerts, manyChangedThreshold, noteSweepFailure, sweepStalledSince } from '../src/catalog/alerts'
import { DEFAULT_BACKUP_CONFIG, setBackupConfig } from '../src/catalog/backups'
import { runSweep } from '../src/catalog/sweeper'
import { createHarness, createUser, json, setUpAdmin, signIn, cookiesFrom, type Harness } from './harness'

let h: Harness
let admin: string

beforeEach(async () => {
  h = await createHarness()
  admin = await setUpAdmin(h)
})
afterEach(async () => h.dispose())

// Today, on the hour: the alerts page lists alerts resolved in the last 14 days by the real clock.
const NOW = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000)
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

interface AlertJson {
  id: string
  kind: string
  message: string
  link: string | null
  openedAt: string
  dismissedAt: string | null
  dismissedBy: string | null
  resolvedAt: string | null
}
const list = async () => (await (await h.fetch('/api/alerts', { cookie: admin })).json()) as { open: AlertJson[]; resolved: AlertJson[]; sweepStalledSince: string | null }
const kinds = async () => (await list()).open.map((a) => a.kind).sort()

let agents = 0
/** An agent as the heartbeat leaves it. */
async function agent(name: string, platform: string, lastSeen: string | null, status: object = {}, archive: object = {}): Promise<string> {
  const id = `s${++agents}`
  await h.env.DB.batch([
    h.env.DB.prepare("INSERT INTO storage_connections (id, name, provider, auth_mode, storage_classes, default_class, is_default, created_at, updated_at) VALUES (?, ?, 'nas', 'agent', '[\"NAS\"]', 'NAS', 0, ?, ?)").bind(`nas-${id}`, name, ago(DAY), ago(DAY)),
    h.env.DB.prepare('INSERT INTO sources (id, name, connection_id, platform, last_seen_at, status, archive, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, name, `nas-${id}`, platform, lastSeen, JSON.stringify(status), JSON.stringify(archive), ago(DAY)),
  ])
  return id
}
const seen = (id: string, at: string) => h.env.DB.prepare('UPDATE sources SET last_seen_at = ? WHERE id = ?').bind(at, id).run()

describe('alerts', () => {
  beforeEach(async () => {
    // A backup a day ago: only the alerts a test sets up.
    await h.env.DB.prepare("INSERT INTO backups (id, connection_id, status, started_at, finished_at) VALUES ('b0', 'r2', 'done', ?, ?)").bind(ago(DAY), ago(DAY)).run()
  })

  it('opens when an agent stops checking in, a day for a Mac, and resolves when it is back', async () => {
    const nas = await agent('Studio NAS', 'linux/x64', ago(40 * MIN))
    await agent('Laptop', 'darwin/x64', ago(5 * HOUR))
    await agent('Never', 'linux/arm64', null)
    expect(await checkAlerts(h.env, NOW)).toEqual({ opened: 2, resolved: 0 })
    const { open } = await list()
    expect(open.map((a) => a.message).sort()).toEqual([
      '“Never” was connected but has never checked in.',
      '“Studio NAS” hasn’t checked in for over half an hour. Is the agent running, and the NAS online?',
    ])
    expect(open[0]!.link).toBe('/sources')

    // Still down five minutes later: the same alert, not another.
    expect(await checkAlerts(h.env, new Date(NOW.getTime() + 5 * MIN))).toEqual({ opened: 0, resolved: 0 })
    await seen(nas, NOW.toISOString())
    expect(await checkAlerts(h.env, NOW)).toEqual({ opened: 0, resolved: 1 })
    const after = await list()
    expect(after.open).toHaveLength(1)
    expect(after.resolved.map((a) => a.message)).toEqual(['“Studio NAS” hasn’t checked in for over half an hour. Is the agent running, and the NAS online?'])

    // A Mac asleep for over a day.
    await h.env.DB.prepare("UPDATE sources SET last_seen_at = ? WHERE name = 'Laptop'").bind(ago(25 * HOUR)).run()
    await checkAlerts(h.env, NOW)
    expect((await list()).open.find((a) => a.message.startsWith('“Laptop”'))?.message).toBe('“Laptop” hasn’t checked in for over a day. Is the computer on, and the helper running?')
  })

  it('reports folders the system refuses, and archiving failures while archiving is on', async () => {
    await agent('Mac', 'darwin/arm64', NOW.toISOString(), { denied: ['/Users/sam/Pictures', '/Users/sam/Desktop'], archive: { lastError: 'a.jpg: 403 AccessDenied' } }, { connectionId: 'aws' })
    await agent('Off', 'linux/x64', NOW.toISOString(), { denied: [], archive: { lastError: 'old news' } }, {})
    await checkAlerts(h.env, NOW)
    expect((await list()).open.map((a) => a.message).sort()).toEqual([
      'Archiving from “Mac” failed: a.jpg: 403 AccessDenied',
      '“Mac” isn’t allowed to read /Users/sam/Pictures and 1 other folder.',
    ])
  })

  it('keeps archiving’s alerts open while files are given up, unreadable or refused, not only after a failed pass', async () => {
    const clean = { gaveUp: { files: 0, bytes: 0 }, cantRead: { new: 0, archived: 0 }, notReadYet: 0, bucket: { refusing: null, until: null }, lastGaveUp: null, lastError: null }
    const mac = await agent('Mac', 'darwin/arm64', NOW.toISOString(), { archive: { ...clean, gaveUp: { files: 2, bytes: 10 }, lastGaveUp: { path: 'a.jpg', error: 'refused', at: null }, cantRead: { new: 5, archived: 1 }, bucket: { refusing: 'AccessDenied', until: null } } }, { connectionId: 'aws' })
    await checkAlerts(h.env, NOW)
    expect((await list()).open.map((a) => a.message).sort()).toEqual([
      '1 file “Mac” has archived can no longer be read. Its archived copy is kept; check the file.',
      'The archive bucket refuses “Mac”: AccessDenied. Archiving waits and tries again; check the bucket and its role or keys.',
      '“Mac” couldn’t archive 2 files, even after trying again. The last: a.jpg: refused',
    ])
    // A clean pass doesn't close them: only the counts going to nothing does.
    await h.env.DB.prepare('UPDATE sources SET status = ? WHERE id = ?').bind(JSON.stringify({ archive: { ...clean, gaveUp: { files: 2, bytes: 10 } } }), mac).run()
    await checkAlerts(h.env, NOW)
    expect(await kinds()).toEqual(['agent.archiveGaveUp'])
    await h.env.DB.prepare('UPDATE sources SET status = ? WHERE id = ?').bind(JSON.stringify({ archive: clean }), mac).run()
    await checkAlerts(h.env, NOW)
    expect(await kinds()).toEqual([])
  })

  it('opens when many archived files change or turn unreadable in a day', async () => {
    const counts = (changed: number, unreadable: number) => ({ archive: { gaveUp: { files: 0, bytes: 0 }, cantRead: { new: 0, archived: 0 }, bucket: { refusing: null, until: null }, archivedFiles: 200_000, changedArchived24h: changed, cantReadArchived24h: unreadable } })
    const nas = await agent('Studio NAS', 'linux/x64', NOW.toISOString(), counts(49, 0), { connectionId: 'aws' })
    await checkAlerts(h.env, NOW)
    expect(await kinds()).toEqual([])
    await h.env.DB.prepare('UPDATE sources SET status = ? WHERE id = ?').bind(JSON.stringify(counts(50, 3)), nas).run()
    await checkAlerts(h.env, NOW)
    expect((await list()).open.map((a) => a.message)).toEqual([
      'In the last day 50 archived originals on “Studio NAS” changed and 3 can no longer be read. That can be ransomware, a sync gone wrong or a failing disk. The earlier copies are kept; check the files before they’re archived again.',
    ])
    // A small archive: 1%, but never under 10.
    expect([manyChangedThreshold(300), manyChangedThreshold(2_000), manyChangedThreshold(1_000_000)]).toEqual([10, 20, 50])
  })

  it('counts originals missing, changed or unreadable in storage', async () => {
    const row = (id: string, result: string) => [
      h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at) VALUES (?, 'x.jpg', 'image/jpeg', 1, 'ready', 'x', 'x')").bind(id),
      h.env.DB.prepare("INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, updated_at, check_result) VALUES (?, 'r2', ?, 'STANDARD', 'present', 'x', ?)").bind(id, `k/${id}`, result),
    ]
    await h.env.DB.batch([...row('a', 'missing'), ...row('b', 'changed'), ...row('c', 'unreadable'), ...row('d', 'ok')])
    await checkAlerts(h.env, NOW)
    expect((await list()).open.map((a) => a.message).sort()).toEqual([
      '1 original couldn’t be checked: the store didn’t answer, or refused the credentials.',
      '2 originals are missing or changed in storage.',
    ])
    // Put back: the alert updates, then resolves.
    await h.env.DB.prepare("UPDATE asset_locations SET check_result = 'ok' WHERE asset_id = 'a'").run()
    await checkAlerts(h.env, NOW)
    expect((await list()).open.map((a) => a.message)).toContain('1 original is missing or changed in storage.')
    await h.env.DB.prepare("UPDATE asset_locations SET check_result = 'ok'").run()
    await checkAlerts(h.env, NOW)
    expect(await kinds()).toEqual([])
  })

  it('counts photos that couldn’t be processed or have waited a day, and AI review that gave up', async () => {
    const photo = (id: string, status: string, updated: string, ai: [string | null, number, string | null] = [null, 0, null]) =>
      h.env.DB.prepare("INSERT INTO assets (id, filename, mime_type, size, status, created_at, updated_at, ai_status, ai_attempts, ai_error) VALUES (?, 'x.jpg', 'image/jpeg', 1, ?, ?, ?, ?, ?, ?)")
        .bind(id, status, updated, updated, ...ai)
    await h.env.DB.batch([
      photo('e1', 'error', ago(HOUR)),
      photo('e2', 'error', ago(HOUR)),
      photo('q1', 'queued', ago(25 * HOUR)),
      photo('q2', 'queued', ago(HOUR)), // queued an hour ago: not stuck yet
      photo('a1', 'ready', ago(HOUR), ['failed', 3, 'Model timed out']),
      photo('a2', 'ready', ago(HOUR), ['failed', 1, 'Will try again']),
    ])
    await checkAlerts(h.env, NOW)
    const { open } = await list()
    expect(open.map((a) => [a.kind, a.message, a.link]).sort()).toEqual([
      ['ai.failed', 'AI review gave up on 1 photo after three tries: Model timed out', '/?failed=ai'],
      ['processing.failed', '2 photos couldn’t be processed: their details or previews may be incomplete.', '/?failed=1'],
      ['processing.stuck', '1 photo has waited over a day to be processed. Is background work running?', null],
    ])
    // The alert's link shows them in the library.
    expect(((await (await h.fetch('/api/assets?failed=1', { cookie: admin })).json()) as { total: number }).total).toBe(2)
    expect(((await (await h.fetch('/api/assets?failed=ai', { cookie: admin })).json()) as { total: number }).total).toBe(1)

    await h.env.DB.prepare("UPDATE assets SET status = 'ready', ai_status = 'done'").run()
    await checkAlerts(h.env, NOW)
    expect(await kinds()).toEqual([])
  })

  it('opens when originals have waited a day to be archived and nothing has been copied for a day', async () => {
    const item = (id: string, state: string, updated: string) => [
      h.env.DB.prepare("INSERT OR IGNORE INTO assets (id, filename, mime_type, size, status, created_at, updated_at) VALUES (?, 'x.jpg', 'image/jpeg', 1, 'ready', 'x', 'x')").bind(id),
      h.env.DB.prepare("INSERT INTO archive_items (asset_id, connection_id, storage_class, state, updated_at) VALUES (?, 'aws', 'DEEP_ARCHIVE', ?, ?)").bind(id, state, updated),
    ]
    await h.env.DB.batch([...item('w1', 'waiting', ago(2 * DAY)), ...item('w2', 'waiting', ago(HOUR)), ...item('d1', 'done', ago(30 * HOUR))])
    await checkAlerts(h.env, NOW)
    expect((await list()).open.map((a) => a.message)).toEqual(['2 originals are waiting to be archived, and nothing has been copied for over a day.'])
    // One copied an hour ago: it's moving, slowly.
    await h.env.DB.prepare("UPDATE archive_items SET updated_at = ? WHERE asset_id = 'd1'").bind(ago(HOUR)).run()
    await checkAlerts(h.env, NOW)
    expect(await kinds()).toEqual([])
  })

  it('opens when a backup fails or none has finished in two days, unless backups are off', async () => {
    await h.env.DB.prepare("INSERT INTO backups (id, connection_id, status, started_at, finished_at, error) VALUES ('b1', 'r2', 'failed', ?, ?, 'R2 said no')").bind(ago(HOUR), ago(HOUR)).run()
    await checkAlerts(h.env, NOW)
    expect((await list()).open.map((a) => a.message)).toEqual(['The last catalog backup failed: R2 said no'])

    await h.env.DB.prepare("UPDATE backups SET started_at = ? WHERE id = 'b0'").bind(ago(3 * DAY)).run()
    await checkAlerts(h.env, NOW)
    expect(await kinds()).toEqual(['backup.failed', 'backup.overdue'])

    await setBackupConfig(h.env.DB, { ...DEFAULT_BACKUP_CONFIG, connectionId: null })
    await checkAlerts(h.env, NOW)
    expect(await kinds()).toEqual([])
  })

  it('counts a new install as overdue only two days after it was set up', async () => {
    await h.env.DB.prepare('DELETE FROM backups').run()
    await checkAlerts(h.env, new Date(Date.now() + DAY))
    expect(await kinds()).toEqual([])
    await checkAlerts(h.env, new Date(Date.now() + 3 * DAY))
    expect((await list()).open.map((a) => a.message)).toEqual(['No catalog backup has finished yet.'])
  })

  it('keeps a failing sweep stage open while it fails, and resolves it after a quiet quarter hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(NOW)
      await noteSweepFailure(h.env.DB, 'backup', new Error('D1 is down'))
      vi.setSystemTime(new Date(NOW.getTime() + 5 * MIN))
      await noteSweepFailure(h.env.DB, 'backup', new Error('D1 is still down'))
      const { open } = await list()
      expect(open.map((a) => a.message)).toEqual(['Background work (catalog backups) is failing: D1 is still down'])
      // Each reader sees it in their own language, the stage's name too.
      const german = (await (await h.fetch('/api/alerts', { cookie: `${admin}; cfdam_lang=de` })).json()) as { open: AlertJson[] }
      expect(german.open.map((a) => a.message)).toEqual(['Hintergrundarbeit (Katalogsicherungen) schlägt fehl: D1 is still down'])
      expect(open[0]!.openedAt).toBe(NOW.toISOString())
      await checkAlerts(h.env, new Date(NOW.getTime() + 15 * MIN))
      expect(await kinds()).toEqual(['sweep.failed'])
      await checkAlerts(h.env, new Date(NOW.getTime() + 21 * MIN))
      expect(await kinds()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('can be dismissed out of the count, and counted again; a stopped sweep counts too', async () => {
    await agent('Studio NAS', 'linux/x64', ago(2 * HOUR))
    await agent('Other NAS', 'linux/x64', ago(2 * HOUR))
    await checkAlerts(h.env, NOW)
    expect(await alertCount(h.env.DB, NOW)).toBe(2)
    const [first] = (await list()).open
    expect((await h.fetch(`/api/alerts/${first!.id}/dismiss`, { method: 'POST', cookie: admin })).status).toBe(204)
    expect((await h.fetch(`/api/alerts/${first!.id}/dismiss`, { method: 'POST', cookie: admin })).status).toBe(404)
    expect(await alertCount(h.env.DB, NOW)).toBe(1)
    const dismissed = (await list()).open.find((a) => a.id === first!.id)!
    expect(dismissed.dismissedBy).toBe('Ada Admin')
    // Still down: stays dismissed.
    await checkAlerts(h.env, NOW)
    expect(await alertCount(h.env.DB, NOW)).toBe(1)
    expect((await h.env.DB.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'alert.dismissed'").first<{ n: number }>())!.n).toBe(1)

    expect((await h.fetch(`/api/alerts/${first!.id}/restore`, { method: 'POST', cookie: admin })).status).toBe(204)
    expect(await alertCount(h.env.DB, NOW)).toBe(2)

    // Twenty-odd minutes without a check: the sweep has stopped.
    const later = new Date(NOW.getTime() + 25 * MIN)
    expect(await alertCount(h.env.DB, later)).toBe(3)
    expect(await sweepStalledSince(h.env.DB, later)).toBe(NOW.toISOString())
    expect(await sweepStalledSince(h.env.DB, NOW)).toBeNull()
  })

  it('are for those allowed to see them', async () => {
    await createUser(h, admin, { name: 'Vic Viewer', email: 'vic@example.com', password: 'a long viewer password', roles: ['viewer'] })
    const viewer = cookiesFrom(await signIn(h, 'vic@example.com', 'a long viewer password'))
    expect((await h.fetch('/api/alerts', { cookie: viewer })).status).toBe(403)
    expect((await h.fetch('/api/alerts/x/dismiss', { ...json({}), cookie: viewer })).status).toBe(403)
  })

  it('are looked for by the sweep every five minutes', async () => {
    expect([0, 1, 4, 5, 55].map((m) => alertsDue(new Date(Date.UTC(2026, 9, 21, 12, m))))).toEqual([true, false, false, true, true])
    await agent('Studio NAS', 'linux/x64', '2026-10-21T10:00:00Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-21T12:01:00Z'))
      expect((await runSweep(h.env)).alerts).toBeNull()
      vi.setSystemTime(new Date('2026-10-21T12:05:00Z'))
      expect((await runSweep(h.env)).alerts).toEqual({ opened: 1, resolved: 0 })
    } finally {
      vi.useRealTimers()
    }
  })
})
