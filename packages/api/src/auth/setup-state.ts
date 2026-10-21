/**
 * Whether the install is still being set up: nobody has an account yet, or a catalog is being restored
 * from a backup (catalog/restore.ts) and the person restoring hasn't chosen their sign-in. Pages send
 * everyone to /setup, sign-ins are refused, and the sweep does only the restore.
 */

// Once set up there is no going back, so remember it for the life of the isolate.
let setupDone = false

export async function setupNeeded(db: D1Database): Promise<boolean> {
  if (setupDone) return false
  const row = await db
    .prepare("SELECT EXISTS (SELECT 1 FROM users) AS users, EXISTS (SELECT 1 FROM restore_jobs WHERE status != 'finished') AS restoring")
    .first<{ users: number; restoring: number }>()
    // A database from before restores (migration tests): accounts alone decide.
    .catch(() => db.prepare('SELECT EXISTS (SELECT 1 FROM users) AS users, 0 AS restoring').first<{ users: number; restoring: number }>())
  const needed = !row?.users || row.restoring === 1
  if (!needed) setupDone = true
  return needed
}

/** Setup has just finished in this isolate. */
export function markSetupDone(): void {
  setupDone = true
}

/** Test hook: forget the cached "setup done" flag between test databases. */
export function resetSetupCacheForTests(): void {
  setupDone = false
}
