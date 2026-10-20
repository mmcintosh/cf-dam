-- 0028: catalog backups (plans/PLAN-S-v1.md in cf-dam-docs, slice S2). One row per backup, kept until
-- its files are deleted. The objects themselves are under cf-dam-backups/<id>/ in the destination;
-- a backup is whole only once its manifest.json is written (status 'done').
CREATE TABLE IF NOT EXISTS backups (
  id             TEXT PRIMARY KEY,
  connection_id  TEXT NOT NULL,
  status         TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  rows           INTEGER NOT NULL DEFAULT 0,
  bytes          INTEGER NOT NULL DEFAULT 0,
  chunks         INTEGER NOT NULL DEFAULT 0,
  error          TEXT
);
CREATE INDEX IF NOT EXISTS idx_backups_started ON backups(started_at);
