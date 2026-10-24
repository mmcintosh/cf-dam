/**
 * Alerts (plans/PLAN-A-v1.md): problems that need a person, shown in the app.
 *
 * Every few minutes the sweep looks for them all at once (`checkAlerts`), in one round trip, and
 * opens an alert for each new one and resolves those that are gone, in another. A stage of the sweep
 * that fails reports itself as it happens (`noteSweepFailure`); that alert resolves once the stage has
 * gone a quarter of an hour without failing again. The sweep stopping altogether can't be noticed by
 * the sweep, so the page works it out from when alerts were last checked (`sweepStalledSince`).
 */
import { imageUsage } from '../lib/images'
import type { DamBindings } from '../env'
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { getT, type MessageKey, type Params, type Translate } from '@cf-dam/i18n'
import { parseConfig } from './backups'

/** How often the sweep looks for problems. */
export const ALERT_EVERY_MINUTES = 5
/** A Docker agent runs all the time; a Mac or PC sleeps, so only a day's silence is a problem. */
export const OFFLINE_MS = { server: 30 * 60_000, desktop: 24 * 3_600_000 }
/** A daily backup that hasn't happened in this long. */
export const BACKUP_OVERDUE_MS = 50 * 3_600_000
/** A failed sweep stage counts as recovered after this long without failing. */
export const SWEEP_RECOVERED_MS = 15 * 60_000
/** Alerts not checked for this long mean the sweep itself has stopped. */
export const SWEEP_STALLED_MS = 20 * 60_000
const CHECKED_KEY = 'alerts.checked_at'

/** A sentence to show in the reader's language: a translation key and its values. */
export interface AlertText {
  key: MessageKey
  params?: Params
}

export interface Finding {
  key: string
  kind: string
  text: AlertText
  link: string | null
}

/** The sentence in one language; a sweep stage is named in that language too. */
export function alertSentence(text: AlertText, t: Translate): string {
  const stage = text.params?.stage
  const params = typeof stage === 'string' && SWEEP_STAGES.includes(stage) ? { ...text.params, stage: t(`alert.stage.${stage}` as MessageKey) } : text.params
  return t(text.key, params)
}

/** The English sentence, kept in `message` for older readers and the activity log. */
export const alertMessage = (text: AlertText) => alertSentence(text, getT('en')).slice(0, 500)

/** A stored alert in the reader's language: its sentence if it has one this version knows, else as stored. */
export function readAlert(stored: { message: string; text: string | null }, t: Translate): string {
  const text = json<AlertText | null>(stored.text, null)
  if (!text?.key) return stored.message
  const sentence = alertSentence(text, t)
  return sentence === text.key ? stored.message : sentence
}
/** Error text from elsewhere, kept short enough for the sentence around it. */
const clip = (s: string) => s.slice(0, 400)

interface SourceRow {
  id: string
  name: string
  platform: string | null
  last_seen_at: string | null
  created_at: string
  status: string
  archive: string
}

interface OpenRow {
  id: string
  key: string
  message: string
}

const json = <T>(text: string | null | undefined, fallback: T): T => {
  try {
    return text ? (JSON.parse(text) as T) : fallback
  } catch {
    return fallback
  }
}

/** What's wrong now, from what the catalog holds. */
export async function findProblems(db: D1Database, now = new Date()): Promise<{ findings: Finding[]; open: OpenRow[] }> {
  const [sources, checks, backup, install, open, previews] = await db.batch([
    db.prepare('SELECT id, name, platform, last_seen_at, created_at, status, archive FROM sources WHERE revoked_at IS NULL'),
    // The problem results only, through their index: fast however many originals are fine.
    db.prepare("SELECT check_result AS result, COUNT(*) AS n FROM asset_locations WHERE check_result IN ('missing', 'changed', 'unreadable') GROUP BY check_result"),
    db.prepare(
      `SELECT (SELECT value FROM settings WHERE key = 'backup') AS config,
              (SELECT MAX(started_at) FROM backups WHERE status = 'done') AS last_done,
              (SELECT status FROM backups ORDER BY started_at DESC LIMIT 1) AS last_status,
              (SELECT error FROM backups ORDER BY started_at DESC LIMIT 1) AS last_error`,
    ),
    db.prepare('SELECT MIN(created_at) AS at FROM users'),
    db.prepare('SELECT id, key, message FROM alerts WHERE resolved_at IS NULL'),
    db.prepare("SELECT COUNT(*) AS n FROM preview_requests WHERE route IN ('archived', 'unreadable')"),
  ])
  const findings: Finding[] = []

  for (const s of sources!.results as unknown as SourceRow[]) {
    const desktop = /^(darwin|win32)/.test(s.platform ?? '')
    const limit = desktop ? OFFLINE_MS.desktop : OFFLINE_MS.server
    const seen = Date.parse(s.last_seen_at ?? s.created_at)
    if (now.getTime() - seen > limit) {
      findings.push({
        key: `agent.offline:${s.id}`,
        kind: 'agent.offline',
        text: { key: s.last_seen_at ? (desktop ? 'alert.offlineDesktop' : 'alert.offlineServer') : 'alert.neverCheckedIn', params: { name: s.name } },
        link: '/sources',
      })
      // Whatever it said last is out of date.
      continue
    }
    const status = json<{ denied?: string[]; archive?: { lastError?: string | null } }>(s.status, {})
    if (status.denied?.length) {
      findings.push({ key: `agent.denied:${s.id}`, kind: 'agent.denied', text: status.denied.length > 1 ? { key: 'alert.deniedMore', params: { name: s.name, folder: status.denied[0]!, count: status.denied.length - 1 } } : { key: 'alert.denied', params: { name: s.name, folder: status.denied[0]! } }, link: '/sources' })
    }
    const archiving = json<{ connectionId?: string | null }>(s.archive, {}).connectionId
    if (archiving && status.archive?.lastError) {
      findings.push({ key: `agent.archive:${s.id}`, kind: 'agent.archive', text: { key: 'alert.archiveFailed', params: { name: s.name, error: clip(status.archive.lastError) } }, link: '/sources' })
    }
  }

  const counts = new Map((checks!.results as { result: string; n: number }[]).map((r) => [r.result, r.n]))
  const gone = (counts.get('missing') ?? 0) + (counts.get('changed') ?? 0)
  if (gone > 0) {
    findings.push({ key: 'storage.problems', kind: 'storage.problems', text: { key: 'alert.storageProblems', params: { count: gone } }, link: '/settings/storage' })
  }
  const unreadable = counts.get('unreadable') ?? 0
  if (unreadable > 0) {
    findings.push({ key: 'storage.unreadable', kind: 'storage.unreadable', text: { key: 'alert.storageUnreadable', params: { count: unreadable } }, link: '/settings/storage' })
  }

  const b = backup!.results[0] as { config: string | null; last_done: string | null; last_status: string | null; last_error: string | null }
  if (parseConfig(b.config).connectionId) {
    if (b.last_status === 'failed') {
      findings.push({ key: 'backup.failed', kind: 'backup.failed', text: b.last_error ? { key: 'alert.backupFailedWhy', params: { error: clip(b.last_error) } } : { key: 'alert.backupFailed' }, link: '/settings/storage' })
    }
    const since = b.last_done ?? (install!.results[0] as { at: string | null }).at
    if (since && now.getTime() - Date.parse(since) > BACKUP_OVERDUE_MS) {
      findings.push({ key: 'backup.overdue', kind: 'backup.overdue', text: { key: b.last_done ? 'alert.backupOverdue' : 'alert.backupNever' }, link: '/settings/storage' })
    }
  }

  const noPreview = (previews!.results[0] as { n: number }).n
  if (noPreview > 0) {
    findings.push({ key: 'previews.stuck', kind: 'previews.stuck', text: { key: 'alert.previewsStuck', params: { count: noPreview } }, link: '/settings/storage' })
  }

  // Originals that couldn't be copied to the archive after three tries (archive-jobs.ts).
  const failedArchive = await db.prepare("SELECT COUNT(*) AS n, MAX(error) AS error FROM archive_items WHERE state = 'failed'").first<{ n: number; error: string | null }>()
  if ((failedArchive?.n ?? 0) > 0) {
    findings.push({ key: 'archive.failed', kind: 'archive.failed', text: { key: 'alert.archiveCopyFailed', params: { count: failedArchive!.n, error: clip(failedArchive!.error ?? '') } }, link: '/jobs' })
  }

  // Cloudflare Images used this month past the threshold set on the Storage page (lib/images.ts). The key has
  // the month in it, so next month the alert resolves by itself.
  const images = await imageUsage(db)
  if (images.alertAt > 0 && images.count >= images.alertAt) {
    findings.push({ key: `images.usage:${images.month}`, kind: 'images.usage', text: { key: 'alert.imagesUsage', params: { count: images.count, limit: images.alertAt } }, link: '/settings/storage' })
  }

  return { findings, open: open!.results as unknown as OpenRow[] }
}

const openStatement = (db: D1Database, f: Finding, at: string) =>
  db
    .prepare(
      `INSERT INTO alerts (id, key, kind, message, text, link, opened_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) WHERE resolved_at IS NULL DO UPDATE SET message = excluded.message, text = excluded.text, seen_at = excluded.seen_at`,
    )
    .bind(randomId(), f.key, f.kind, alertMessage(f.text), JSON.stringify(f.text), f.link, at, at)

/** Open alerts for new problems, update those still there, resolve those gone. Two round trips. */
export async function checkAlerts(env: DamBindings, now = new Date()): Promise<{ opened: number; resolved: number }> {
  const db = env.DB
  const at = now.toISOString()
  const { findings, open } = await findProblems(db, now)
  const openKeys = new Map(open.map((a) => [a.key, a]))
  const found = new Set(findings.map((f) => f.key))
  const statements: D1PreparedStatement[] = []
  let opened = 0
  for (const f of findings) {
    if (!openKeys.has(f.key)) opened++
    statements.push(openStatement(db, f, at))
  }
  // A sweep stage's alert is kept open by the stage itself; it resolves after a quiet spell.
  const gone = open.filter((a) => !a.key.startsWith('sweep:') && !found.has(a.key))
  for (const a of gone) statements.push(db.prepare('UPDATE alerts SET resolved_at = ? WHERE id = ?').bind(at, a.id))
  const recovered = await db.batch([
    ...statements,
    db.prepare("UPDATE alerts SET resolved_at = ? WHERE resolved_at IS NULL AND key LIKE 'sweep:%' AND seen_at < ? RETURNING id").bind(at, new Date(now.getTime() - SWEEP_RECOVERED_MS).toISOString()),
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(CHECKED_KEY, at, at),
  ])
  return { opened, resolved: gone.length + recovered[statements.length]!.results.length }
}

/** Whether this minute's sweep looks for problems. */
export const alertsDue = (now = new Date()) => now.getUTCMinutes() % ALERT_EVERY_MINUTES === 0

/** A stage of the sweep failed: open (or keep open) its alert. Never throws. */
export async function noteSweepFailure(db: D1Database, stage: string, error: unknown): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error)
  await openStatement(db, { key: `sweep:${stage}`, kind: 'sweep.failed', text: { key: 'alert.sweepFailed', params: { stage, reason: clip(reason) } }, link: null }, nowIso())
    .run()
    .catch((e) => console.warn('[alerts] could not record a sweep failure', e))
}

/** A sweep stage's name, for "Background work (…) is failing". */
export const SWEEP_STAGES = ['recover', 'archive', 'restores', 'gallery', 'checks', 'backup', 'stats', 'previews', 'meaning', 'jobs', 'alerts', 'facets']

/** When the sweep last ran, if that's long enough ago to mean it has stopped. */
export async function sweepStalledSince(db: D1Database, now = new Date()): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(CHECKED_KEY).first<{ value: string }>()
  return row && now.getTime() - Date.parse(row.value) > SWEEP_STALLED_MS ? row.value : null
}

/** The sidebar's count: open alerts nobody has dismissed, and the sweep if it has stopped. One query. */
export async function alertCount(db: D1Database, now = new Date()): Promise<number> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM alerts WHERE resolved_at IS NULL AND dismissed_at IS NULL) AS n,
              (SELECT value FROM settings WHERE key = ?) AS checked`,
    )
    .bind(CHECKED_KEY)
    .first<{ n: number; checked: string | null }>()
  const stalled = row?.checked && now.getTime() - Date.parse(row.checked) > SWEEP_STALLED_MS
  return (row?.n ?? 0) + (stalled ? 1 : 0)
}
