/** Catalog backups for the Storage page (catalog/backups.ts does the work). Needs `sources:manage`. */
import { Hono } from 'hono'
import { requirePermission } from '../auth/principal'
import { getBackupConfig, getBackupState, setBackupConfig, startBackup, type BackupConfig } from '../catalog/backups'
import type { DamEnv } from '../env'
import { logActivity } from '../lib/activity'
import { BadRequest, readJsonObject } from '../lib/http'
import { getConnection } from '../storage/connections'

const LISTED = 30

interface BackupRow {
  id: string
  connection_id: string
  connection_name: string | null
  status: string
  started_at: string
  finished_at: string | null
  rows: number
  bytes: number
  chunks: number
  error: string | null
}

export const backupRoutes = new Hono<DamEnv>()

backupRoutes.use('*', requirePermission('sources:manage'))

backupRoutes.get('/', async (c) => {
  const db = c.env.DB
  const [config, state, { results }] = await Promise.all([
    getBackupConfig(db),
    getBackupState(db),
    db
      .prepare(
        `SELECT b.*, s.name AS connection_name FROM backups b LEFT JOIN storage_connections s ON s.id = b.connection_id
         WHERE b.status != 'deleting' ORDER BY b.started_at DESC LIMIT ?`,
      )
      .bind(LISTED)
      .all<BackupRow>(),
  ])
  return c.json({
    config,
    running: state
      ? {
          id: state.id,
          startedAt: state.startedAt,
          tablesDone: state.table,
          tables: state.tables.length,
          rows: Object.values(state.counts).reduce((n, t) => n + t.rows, 0),
          failures: state.failures,
        }
      : null,
    backups: results.map((b) => ({
      id: b.id,
      connectionId: b.connection_id,
      connectionName: b.connection_name,
      status: b.status,
      startedAt: b.started_at,
      finishedAt: b.finished_at,
      rows: b.rows,
      bytes: b.bytes,
      error: b.error,
    })),
  })
})

backupRoutes.put('/config', async (c) => {
  try {
    const body = await readJsonObject(c)
    const connectionId = body.connectionId
    const hour = body.hour
    const keepDays = body.keepDays
    if (connectionId !== null && typeof connectionId !== 'string') throw new BadRequest('connectionId must be a connection id, or null to turn backups off.')
    if (!Number.isInteger(hour) || (hour as number) < 0 || (hour as number) > 23) throw new BadRequest('hour must be a whole hour, 0 to 23 (UTC).')
    if (!Number.isInteger(keepDays) || (keepDays as number) < 1 || (keepDays as number) > 365) throw new BadRequest('keepDays must be 1 to 365.')
    if (connectionId) {
      const connection = await getConnection(c.env.DB, connectionId)
      if (!connection) throw new BadRequest('No such storage connection.')
      if (connection.provider === 'nas') throw new BadRequest('A NAS connection can only be read by its agent; choose a bucket.')
    }
    const config: BackupConfig = { connectionId, hour: hour as number, keepDays: keepDays as number }
    await setBackupConfig(c.env.DB, config)
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'backup.settings_changed', details: { ...config }, ipAddress: c.req.header('cf-connecting-ip') })
    return c.json({ config })
  } catch (error) {
    if (error instanceof BadRequest) return c.json({ error: 'invalid_request', message: error.message }, 400)
    throw error
  }
})

/** Start a backup now; the sweep carries it on within a minute. */
backupRoutes.post('/run', async (c) => {
  const config = await getBackupConfig(c.env.DB)
  if (!config.connectionId) return c.json({ error: 'backups_off', message: 'Choose where backups go first.' }, 409)
  try {
    const state = await startBackup(c.env, config.connectionId)
    if (!state) return c.json({ error: 'running', message: 'A backup is already running.' }, 409)
    await logActivity(c.env.DB, { userId: c.get('principal')!.userId, action: 'backup.started', targetType: 'backup', targetId: state.id, ipAddress: c.req.header('cf-connecting-ip') })
    return c.json({ id: state.id }, 202)
  } catch (error) {
    return c.json({ error: 'destination', message: error instanceof Error ? error.message : String(error) }, 409)
  }
})
