-- 0034: making missing previews again (plans/PLAN-S-v1.md in cf-dam-docs, slice S4). Thumbnails and
-- previews live in the built-in R2 bucket and aren't in backups: after a restore into a new account,
-- or if one is ever lost, the photo needs them made again. One row per photo waiting for them, and how
-- they'll come: 'agent' (its agent sends them again), 'worker' (made here from the original), or why
-- they can't be yet: 'archived' (the original is only in an archive class: restore it first) or
-- 'unreadable' (nothing here can make them; `error` says why).
CREATE TABLE IF NOT EXISTS preview_requests (
  asset_id      TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  route         TEXT NOT NULL,
  source_id     TEXT REFERENCES sources(id) ON DELETE CASCADE,
  requested_at  TEXT NOT NULL,
  -- When the agent was last asked, or the Worker last tried: asked again a day later if nothing came.
  asked_at      TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_preview_requests_route ON preview_requests(route, asked_at);
CREATE INDEX IF NOT EXISTS idx_preview_requests_source ON preview_requests(source_id, asked_at) WHERE source_id IS NOT NULL;
