-- 0031: alerts (plans/PLAN-A-v1.md in cf-dam-docs). Something that needs a person: an agent that has
-- stopped checking in, archiving or a backup that fails, originals missing or changed, background work
-- failing. The sweep opens an alert when it finds the problem and resolves it when the problem is gone.
CREATE TABLE IF NOT EXISTS alerts (
  id            TEXT PRIMARY KEY,
  -- What it is about, e.g. 'agent.offline:<source id>' or 'sweep:backup'. One open alert per key.
  key           TEXT NOT NULL,
  kind          TEXT NOT NULL,
  message       TEXT NOT NULL,
  -- Where to go to fix it.
  link          TEXT,
  opened_at     TEXT NOT NULL,
  -- When the problem was last found still there.
  seen_at       TEXT NOT NULL,
  -- Out of the count until it resolves (it opens again if the problem comes back after that).
  dismissed_at  TEXT,
  dismissed_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_open ON alerts(key) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved_at);

INSERT OR IGNORE INTO permissions (id, description) VALUES ('alerts:read', 'See problems that need someone, and dismiss them');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role-admin', 'alerts:read');
