import { randomId } from './crypto'
import { nowIso } from './time'

export interface ActivityEntry {
  userId: string | null
  action: string
  targetType?: string
  targetId?: string
  details?: Record<string, unknown>
  ipAddress?: string | null
}

/** Record an audit event. Best-effort: a failed write is logged, never surfaced to the caller. */
export async function logActivity(db: D1Database, entry: ActivityEntry): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO activity_log (id, user_id, action, target_type, target_id, details, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        randomId(),
        entry.userId,
        entry.action,
        entry.targetType ?? null,
        entry.targetId ?? null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.ipAddress ?? null,
        nowIso(),
      )
      .run()
  } catch (error) {
    console.warn('[activity] write failed', error)
  }
}
