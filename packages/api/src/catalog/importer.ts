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

/** Keys cf-dam never imports: its own probe objects (the connection test, the browser upload test) and "folder" placeholders. */
function ignorable(key: string, size: number): boolean {
  const parts = key.split('/')
  return key.endsWith('/') || parts.at(-1) === '.cf-dam-connection-test' || parts.includes('.cf-dam-browser-test') || (size === 0 && !key.includes('.'))
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
  const { results: existing } = candidates.length
    ? await env.DB.prepare('SELECT key FROM asset_locations WHERE connection_id = ? AND key IN (SELECT value FROM json_each(?))')
        .bind(connection.id, JSON.stringify(candidates.map((o) => o.key)))
        .all<{ key: string }>()
    : { results: [] as { key: string }[] }
  const known = new Set(existing.map((r) => r.key))

  const fresh = candidates.filter((o) => !known.has(o.key))
  const now = nowIso()
  const rows = fresh.map((object) => {
    const filename = safeFilename(object.key)
    const archived = ARCHIVE_CLASSES.has(object.storageClass)
    return {
      id: randomId(), filename, mime: mimeTypeFor(filename, undefined), size: object.size, status: archived ? 'ready' : 'queued', created: object.lastModified ?? now,
      key: object.key, class: object.storageClass, state: archived ? 'archived' : 'present', etag: object.etag,
    }
  })
  const field = (name: string) => `json_extract(j.value, '$.${name}')`
  // In lists of 500 (keys run to about 1 KB; a bound value is at most 2 MB), all in one batch.
  const statements: D1PreparedStatement[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const list = JSON.stringify(rows.slice(i, i + 500))
    statements.push(
      env.DB.prepare(
        `INSERT INTO assets (id, owner_id, filename, mime_type, size, status, created_at, updated_at)
         SELECT ${field('id')}, ?, ${field('filename')}, ${field('mime')}, ${field('size')}, ${field('status')}, ${field('created')}, ? FROM json_each(?) j`,
      ).bind(options.userId, now, list),
      env.DB.prepare(
        `INSERT INTO asset_locations (asset_id, connection_id, key, storage_class, state, size, etag, updated_at)
         SELECT ${field('id')}, ?, ${field('key')}, ${field('class')}, ${field('state')}, ${field('size')}, ${field('etag')}, ? FROM json_each(?) j`,
      ).bind(connection.id, now, list),
    )
  }
  if (statements.length > 0) await env.DB.batch(statements)

  return { listed: page.objects.length, imported: fresh.length, skipped: page.objects.length - fresh.length, cursor: page.cursor }
}
