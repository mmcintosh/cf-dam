-- 0047: jobs (plans/PLAN-C-v2.md, phase C3; catalog/jobs.ts). A job is a piece of work for a client: a wedding, a
-- portrait session, a product shoot. It has shoot dates, a place, a stage, and albums; its galleries are the
-- albums' galleries. A photo can be in several jobs' albums.
CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  -- A client with jobs can't be deleted by accident; Erase client removes their jobs first.
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  title         TEXT NOT NULL,
  -- What the client sees in their galleries ("Your wedding"); the title may be for the team only.
  client_title  TEXT NOT NULL DEFAULT '',
  -- wedding, portrait, family, event, commercial, editorial, other (+ kind_other).
  kind          TEXT NOT NULL DEFAULT 'other',
  kind_other    TEXT NOT NULL DEFAULT '',
  -- Calendar days (YYYY-MM-DD) in the photographer's wall-clock time, like captured_at.
  shoot_start   TEXT,
  shoot_end     TEXT,
  place         TEXT NOT NULL DEFAULT '',
  -- booked, shot, editing, proofing, final_edits, delivered, completed, cancelled.
  stage         TEXT NOT NULL DEFAULT 'booked',
  stage_at      TEXT NOT NULL,
  -- Delivery promised by (YYYY-MM-DD).
  due_on        TEXT,
  delivered_at  TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  -- title, client title, place and the client's name, folded for search (catalog/client-records.ts fold).
  search        TEXT NOT NULL DEFAULT '',
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id, shoot_start DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_stage ON jobs(stage, shoot_start);

-- An album belongs to one job at most. Deleting the job leaves the album.
ALTER TABLE albums ADD COLUMN job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_albums_job ON albums(job_id);

-- A gallery ticked "Final delivery" moves its album's job to Delivered when it's made.
ALTER TABLE shares ADD COLUMN final_delivery INTEGER NOT NULL DEFAULT 0;
