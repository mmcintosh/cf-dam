-- 0050: restoring a whole job (plans/PLAN-C4-v2.md, C4a; catalog/job-storage.ts). A job restore is the request
-- (kept as history); its items are the photos to ask S3 for, worked through by the work queue a few at a time
-- (kind 'restore'), so asking for 3,000 originals doesn't crowd the sweep. Whether an item is ready is read from
-- its location (restored and not expired), which the sweep's restore check keeps up to date.
CREATE TABLE IF NOT EXISTS job_restores (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tier          TEXT NOT NULL,
  days          INTEGER NOT NULL,
  photos        INTEGER NOT NULL,
  bytes         INTEGER NOT NULL,
  requested_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_restores_job ON job_restores(job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restore_items (
  restore_id     TEXT NOT NULL REFERENCES job_restores(id) ON DELETE CASCADE,
  asset_id       TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  connection_id  TEXT NOT NULL,
  -- waiting → asking (claimed) → asked, or failed after 3 attempts.
  state          TEXT NOT NULL DEFAULT 'waiting',
  attempts       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (restore_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_restore_items_state ON restore_items(state, updated_at);
