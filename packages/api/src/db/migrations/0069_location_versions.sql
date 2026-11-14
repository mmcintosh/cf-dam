-- Earlier copies (PLAN-HELPER-ARCHIVE-v2 A.7; internal review B6): archiving a changed file again replaces the photo's
-- location in that bucket, and the copy made before (still in the bucket: cf-dam never deletes originals) was
-- forgotten. If the change was ransomware or a failing disk, the earlier copy is the good one. Each replaced copy is
-- kept here, with the photo's SHA-256 as it was.
CREATE TABLE IF NOT EXISTS asset_location_versions (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES storage_connections(id),
  -- The helper that archived it, when one did.
  source_id TEXT,
  key TEXT NOT NULL,
  size INTEGER,
  quick_hash TEXT,
  sha256 TEXT,
  -- 'bad': an object that completed with the wrong size, kept track of rather than lost.
  storage_class TEXT,
  archived_at TEXT NOT NULL,
  replaced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_location_versions_asset ON asset_location_versions(asset_id);
CREATE INDEX IF NOT EXISTS idx_location_versions_connection ON asset_location_versions(connection_id);
