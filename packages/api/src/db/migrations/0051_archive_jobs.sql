-- 0051: archiving delivered jobs (plans/PLAN-C4-v2.md, C4b; catalog/archive-jobs.ts). A job's originals get a cold
-- copy in S3 some days after it's delivered; the R2 copy stays.
-- archive_from: when the job last entered Delivered or Completed from an open stage (reset on re-delivery, cleared
-- when it goes back to an open stage); the archive is due archive.jobs.afterDays later.
ALTER TABLE jobs ADD COLUMN archive_from TEXT;
-- 1: never archived automatically (reprints, albums in progress).
ALTER TABLE jobs ADD COLUMN keep_hot INTEGER NOT NULL DEFAULT 0;
-- null (not looked at), 'queued' (items waiting), 'done', or 'blocked' (some originals only on a NAS that isn't
-- archiving); archive_note holds the counts as JSON.
ALTER TABLE jobs ADD COLUMN archive_state TEXT;
ALTER TABLE jobs ADD COLUMN archive_note TEXT;
ALTER TABLE jobs ADD COLUMN archived_at TEXT;
UPDATE jobs SET archive_from = delivered_at WHERE stage IN ('delivered', 'completed') AND delivered_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_archive ON jobs(archive_state, archive_from);

-- One original to copy (R2 → S3, in a cold class) or to move to a cold class (a warm S3 copy). Worked by the
-- queue (kind 'archive'), resumable: a multipart copy keeps its upload id and the parts done (number, etag,
-- SHA-256), and the R2 etag it started from.
CREATE TABLE IF NOT EXISTS archive_items (
  asset_id       TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  connection_id  TEXT NOT NULL,
  job_id         TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  action         TEXT NOT NULL DEFAULT 'copy',
  storage_class  TEXT NOT NULL,
  -- waiting → copying (claimed) → done, or failed after 3 attempts.
  state          TEXT NOT NULL DEFAULT 'waiting',
  key            TEXT,
  upload_id      TEXT,
  parts          TEXT NOT NULL DEFAULT '[]',
  source_etag    TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (asset_id, connection_id)
);
CREATE INDEX IF NOT EXISTS idx_archive_items_state ON archive_items(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_archive_items_job ON archive_items(job_id, state);
