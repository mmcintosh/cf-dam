-- 0030: archiving originals from a NAS or Mac to Glacier (plans/PLAN-5o-v1.md in cf-dam-docs).
-- Per agent: where originals are archived and when ({} = not archiving). See catalog/archive.ts.
ALTER TABLE sources ADD COLUMN archive TEXT NOT NULL DEFAULT '{}';
-- Uploads in flight: the agent sends the bytes straight to the bucket; cf-dam signs each part and
-- completes the upload. Our own id stands for the store's long upload id.
CREATE TABLE IF NOT EXISTS archive_uploads (
  id             TEXT PRIMARY KEY,
  source_id      TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  asset_id       TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  connection_id  TEXT NOT NULL REFERENCES storage_connections(id),
  key            TEXT NOT NULL,
  multipart_id   TEXT NOT NULL,
  storage_class  TEXT NOT NULL,
  size           INTEGER NOT NULL,
  quick_hash     TEXT NOT NULL,
  part_size      INTEGER NOT NULL,
  part_count     INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_archive_uploads_asset ON archive_uploads(asset_id);
CREATE INDEX IF NOT EXISTS idx_archive_uploads_created ON archive_uploads(created_at);
-- Finding an archived copy with the same size and fingerprint: a duplicate isn't uploaded twice.
CREATE INDEX IF NOT EXISTS idx_asset_locations_archived ON asset_locations(connection_id, quick_hash, size) WHERE storage_class != 'NAS';
