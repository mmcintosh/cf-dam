-- 0002: storage connections, assets and where their originals live, renditions, uploads in
-- flight, tags, albums and full-text search. Conventions as in 0001.

-- Where originals can live. 'r2' is the built-in connection to the Worker's own R2 binding.
-- An S3 connection's secret is sealed with AES-GCM (storage/secret-box.ts), never stored plain.
CREATE TABLE IF NOT EXISTS storage_connections (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  provider          TEXT NOT NULL,
  endpoint          TEXT,
  region            TEXT,
  bucket            TEXT,
  prefix            TEXT NOT NULL DEFAULT '',
  force_path_style  INTEGER NOT NULL DEFAULT 0,
  auth_mode         TEXT NOT NULL,
  role_arn          TEXT,
  access_key_id     TEXT,
  secret_sealed     TEXT,
  storage_classes   TEXT NOT NULL,
  default_class     TEXT NOT NULL DEFAULT 'STANDARD',
  is_default        INTEGER NOT NULL DEFAULT 0,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

INSERT OR IGNORE INTO storage_connections
  (id, name, provider, auth_mode, storage_classes, default_class, is_default, created_at, updated_at)
VALUES
  ('r2', 'Cloudflare R2 (built in)', 'r2-binding', 'binding', '["STANDARD","STANDARD_IA"]', 'STANDARD', 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- One row per photo, video or document. Hot filter fields are promoted to columns; everything the
-- file says about itself is kept whole in `metadata` (JSON). `captured_at` is the camera's wall
-- clock ("2024-06-15T18:42:07"), with `captured_offset` ("+02:00") when the camera recorded one.
CREATE TABLE IF NOT EXISTS assets (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  filename         TEXT NOT NULL,
  title            TEXT,
  caption          TEXT,
  alt              TEXT,
  mime_type        TEXT NOT NULL,
  size             INTEGER NOT NULL DEFAULT 0,
  sha256           TEXT,
  sha256_verified  INTEGER NOT NULL DEFAULT 0,
  width            INTEGER,
  height           INTEGER,
  orientation      INTEGER,
  captured_at      TEXT,
  captured_offset  TEXT,
  camera_make      TEXT,
  camera_model     TEXT,
  lens             TEXT,
  focal_length     REAL,
  aperture         REAL,
  exposure_time    REAL,
  iso              INTEGER,
  gps_lat          REAL,
  gps_lng          REAL,
  rating           INTEGER,
  metadata         TEXT,
  status           TEXT NOT NULL DEFAULT 'uploading',
  error            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256);
CREATE INDEX IF NOT EXISTS idx_assets_captured_at ON assets(captured_at);
CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_camera_model ON assets(camera_model);
CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets(owner_id);

-- Where each copy of an original lives, and in what state.
CREATE TABLE IF NOT EXISTS asset_locations (
  asset_id            TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  connection_id       TEXT NOT NULL REFERENCES storage_connections(id),
  key                 TEXT NOT NULL,
  storage_class       TEXT NOT NULL DEFAULT 'STANDARD',
  state               TEXT NOT NULL,
  restore_expires_at  TEXT,
  size                INTEGER,
  etag                TEXT,
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (asset_id, connection_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_locations_state ON asset_locations(state);

-- Thumbnails and previews. Always in the built-in R2 bucket, so they stay viewable whatever tier
-- the original is in.
CREATE TABLE IF NOT EXISTS renditions (
  asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  key         TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  size        INTEGER NOT NULL,
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (asset_id, name)
);

-- Uploads in flight. `mode` is 'direct' (client PUTs to presigned URLs) or 'proxied' (parts stream
-- through the Worker, for providers that can't presign).
CREATE TABLE IF NOT EXISTS uploads (
  id             TEXT PRIMARY KEY,
  asset_id       TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  connection_id  TEXT NOT NULL REFERENCES storage_connections(id),
  key            TEXT NOT NULL,
  multipart_id   TEXT NOT NULL,
  mode           TEXT NOT NULL,
  storage_class  TEXT NOT NULL,
  part_size      INTEGER NOT NULL,
  part_count     INTEGER NOT NULL,
  size           INTEGER NOT NULL,
  created_by     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_expires_at ON uploads(expires_at);

CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_tags (
  asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'user',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (asset_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id);

CREATE TABLE IF NOT EXISTS albums (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  cover_asset_id  TEXT REFERENCES assets(id) ON DELETE SET NULL,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS album_items (
  album_id  TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  asset_id  TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  added_at  TEXT NOT NULL,
  PRIMARY KEY (album_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_album_items_asset ON album_items(asset_id);

-- Full text over what people search by. Maintained by the application (catalog/search.ts), not
-- triggers, because the migrator splits on line-ending semicolons.
CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
  asset_id UNINDEXED,
  filename,
  title,
  caption,
  tags,
  camera,
  place,
  tokenize = 'porter unicode61 remove_diacritics 2'
);
