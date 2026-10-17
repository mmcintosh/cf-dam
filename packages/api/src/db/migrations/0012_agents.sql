-- 0012: NAS agents. An agent indexes folders on a NAS (or a computer) and sends metadata and previews;
-- originals stay where they are. Each agent has its own storage connection (provider 'nas'), so its
-- files are ordinary asset_locations rows with storage class 'NAS'.
CREATE TABLE IF NOT EXISTS sources (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  connection_id  TEXT NOT NULL REFERENCES storage_connections(id),
  api_key_id     TEXT REFERENCES api_keys(id) ON DELETE SET NULL,
  platform       TEXT,
  version        TEXT,
  last_seen_at   TEXT,
  -- What the agent last reported: counts, current file, errors, free space (JSON).
  status         TEXT NOT NULL DEFAULT '{}',
  -- Folders the agent can see, for people to choose from (JSON array).
  folders        TEXT NOT NULL DEFAULT '[]',
  paused         INTEGER NOT NULL DEFAULT 0,
  rescan         INTEGER NOT NULL DEFAULT 0,
  revoked_at     TEXT,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_api_key ON sources(api_key_id);

-- Folders an agent indexes. `path` is as the agent sees it (e.g. /photos/photo).
CREATE TABLE IF NOT EXISTS source_roots (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  label         TEXT,
  include_globs TEXT NOT NULL DEFAULT '[]',
  exclude_globs TEXT NOT NULL DEFAULT '[]',
  enabled       INTEGER NOT NULL DEFAULT 1,
  first_scan_done_at TEXT,
  last_scan_at  TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (source_id, path)
);

-- NAS copies: when the file was last seen, its mtime, and a quick fingerprint (SHA-256 of size + first
-- and last MiB) that recognises the same file after a move or rename without reading all of it.
ALTER TABLE asset_locations ADD COLUMN mtime TEXT;
ALTER TABLE asset_locations ADD COLUMN quick_hash TEXT;
ALTER TABLE asset_locations ADD COLUMN seen_at TEXT;
CREATE INDEX IF NOT EXISTS idx_asset_locations_quick ON asset_locations(connection_id, quick_hash);
CREATE INDEX IF NOT EXISTS idx_asset_locations_key ON asset_locations(connection_id, key);

-- Only agent keys carry this; no role grants it.
INSERT OR IGNORE INTO permissions (id, description) VALUES ('agent:sync', 'Act as a paired NAS agent');

-- Pairing, like signing in on a TV: the agent starts a request and shows `user_code`; a person types it
-- into cf-dam; the agent, polling with its secret device code, receives its API key once. In D1 rather
-- than KV so an approval is visible to the agent's next poll wherever it lands.
CREATE TABLE IF NOT EXISTS pairing_requests (
  device_hash  TEXT PRIMARY KEY,
  user_code    TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  platform     TEXT,
  version      TEXT,
  source_id    TEXT REFERENCES sources(id) ON DELETE CASCADE,
  -- The new API key, sealed, until the agent collects it.
  sealed_key   TEXT,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
