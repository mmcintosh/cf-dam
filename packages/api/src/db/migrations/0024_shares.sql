-- 0024: client galleries (plans/PLAN-P4-v1.md). A gallery is a link to an album, with its own password,
-- expiry and choices; clients need no account. Visitors give a name to pick favourites; events count
-- opens and downloads for the photographer's stats.
CREATE TABLE IF NOT EXISTS shares (
  id              TEXT PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,
  album_id        TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  title           TEXT NOT NULL,
  message         TEXT NOT NULL DEFAULT '',
  password_hash   TEXT,
  expires_at      TEXT,
  download_sizes  TEXT NOT NULL DEFAULT '[]',
  watermark       INTEGER NOT NULL DEFAULT 0,
  proofing        INTEGER NOT NULL DEFAULT 1,
  show_filenames  INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  revoked_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_shares_album ON shares(album_id);

CREATE TABLE IF NOT EXISTS share_visitors (
  id            TEXT PRIMARY KEY,
  share_id      TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  submitted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_share_visitors_share ON share_visitors(share_id);

CREATE TABLE IF NOT EXISTS share_picks (
  visitor_id  TEXT NOT NULL REFERENCES share_visitors(id) ON DELETE CASCADE,
  asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  share_id    TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (visitor_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_share_picks_share ON share_picks(share_id, asset_id);

CREATE TABLE IF NOT EXISTS share_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id    TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  visitor_id  TEXT REFERENCES share_visitors(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  asset_id    TEXT REFERENCES assets(id) ON DELETE SET NULL,
  size        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_share_events_share ON share_events(share_id, kind);

INSERT OR IGNORE INTO permissions (id, description) VALUES
  ('shares:manage', 'Share albums with clients, and see what they picked and downloaded');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role-admin', 'shares:manage'),
  ('role-editor', 'shares:manage');
