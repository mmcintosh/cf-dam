-- 0032: bringing a catalog back from a backup into a fresh install (plans/PLAN-S-v1.md in cf-dam-docs,
-- slice S3). One row per restore. The sweep does the work a part at a time; until the person restoring
-- has chosen their sign-in, the install stays on its setup page.
CREATE TABLE IF NOT EXISTS restore_jobs (
  id            TEXT PRIMARY KEY,
  backup_id     TEXT NOT NULL,
  -- Where the backup is: {"kind":"r2"} or an S3 bucket, its secret sealed like a connection's.
  source        TEXT NOT NULL,
  -- running, restored (the rows are in; waiting for a sign-in), finished, failed.
  status        TEXT NOT NULL,
  -- Where it has got to (JSON): the phase, the table, the chunk, the row.
  progress      TEXT NOT NULL,
  rows          INTEGER NOT NULL DEFAULT 0,
  total_rows    INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  failures      INTEGER NOT NULL DEFAULT 0,
  -- A run working on it, until then; another waits.
  lease_until   TEXT,
  started_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_restore_jobs_status ON restore_jobs(status);
