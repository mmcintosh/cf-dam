/**
 * Catalogue an existing bucket in place: every object becomes an asset that points at where it
 * already lives. Nothing is copied. Objects are queued, and the sweep (sweeper.ts) reads their
 * metadata and makes previews, a few at a time, within Worker limits.
 *
 * Archived objects (GLACIER, DEEP_ARCHIVE) can't be read, so they arrive with their name, size and
 * class only; restoring one later lets it be processed.
 */
import type { DamBindings } from '../env'
import { randomId } from '../lib/crypto'
import { nowIso } from '../lib/time'
import { connectionKey, providerFor, type Connection } from '../storage/connections'
import { ARCHIVE_CLASSES } from '../storage/types'
import { mimeTypeFor, safeFilename } from './uploads'

export interface ImportPageResult {
  listed: number
  imported: number
  skipped: number
  cursor: string | null
}

/** Keys cf-dam never imports: its own probe object and "folder" placeholders. */
function ignorable(key: string, size: number): boolean {
  return key.endsWith('/') || key.split('/').pop() === '.cf-dam-connection-test' || (size === 0 && !key.includes('.'))
}

export async function importPage(
  env: DamBindings,
  connection: Connection,
  options: { prefix?: string; cursor?: string; userId: string },
): Promise<ImportPageResult> {
  const provider = providerFor(env, connection)
  const prefix = options.prefix ? connectionKey(connection, options.prefix.replace(/^\/+/, '')) : connection.prefix
  const page = await provider.list(prefix, options.cursor)
  const candidates = page.objects.filter((o) => !ignorable(o.key, o.size))

  // Skip objects already catalogued from this connection (including cf-dam's own uploads).
  const known = new Set<string>()
  for (let i = 0; i < candidates.length; i += 90) {
    const slice = candidates.slice(i, i + 90)
    const { results } = await env.DB.prepare(
      `SELECT key FROM asset_locations WHERE connection_id = ? AND key IN (${slice.map(() => '?').join(',')})`,
    )
      .bind(connection.id, ...slice.map((o) => o.key))
      .all<{ key: string }>()
    for (const row of results) known.add(row.key)
  }

  const fresh = candidates.filter((o) => !known.has(o.key))
  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  for (const object of fresh) {
    const id = randomId()
    const filename = safeFilename(object.key)
    const archived = ARCHIVE_CLASSES.has(object.storageClass)
    statements.push(
      env.DB.prepare(
        `INSERT INTO assets (id, owner_id, filename, mime_type, size, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, options.userId, filename, mimeTypeFor(filename, undefined), object.size, archived ? 'ready' : 'queued', object.lastModified ?? now, now),
      env.DB.prepare(
        `INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, size, etag, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, connection.id, object.key, object.storageClass, archived ? 'archived' : 'present', object.size, object.etag, now),
    )
  }
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100))

  return { listed: page.objects.length, imported: fresh.length, skipped: page.objects.length - fresh.length, cursor: page.cursor }
}
