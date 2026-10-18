-- 0019: the search index keyed by number, and partial indexes for the sweep's queues.
-- assets_fts kept the asset id as an unindexed column, so replacing one asset's row scanned the whole
-- index, and finding unindexed assets compared every asset with every row. search_index uses the
-- asset's search_id as its rowid; indexed_at says when the row was written (NULL: write it again).
ALTER TABLE assets ADD COLUMN search_id INTEGER;
ALTER TABLE assets ADD COLUMN indexed_at TEXT;
UPDATE assets SET search_id = rowid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_search_id ON assets(search_id);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  filename,
  title,
  caption,
  tags,
  camera,
  place,
  ai,
  tokenize = 'porter unicode61 remove_diacritics 2'
);
-- What is indexed now carries over (one row per asset, the newest), so search works straight away.
INSERT INTO search_index (rowid, filename, title, caption, tags, camera, place, ai)
SELECT a.search_id, f.filename, f.title, f.caption, f.tags, f.camera, f.place, f.ai
FROM assets_fts f JOIN assets a ON a.id = f.asset_id
WHERE f.rowid IN (SELECT MAX(rowid) FROM assets_fts GROUP BY asset_id) AND a.deleted_at IS NULL;
UPDATE assets SET indexed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE deleted_at IS NULL AND id IN (SELECT asset_id FROM assets_fts);
DROP TABLE IF EXISTS assets_fts;

-- What the sweep looks for every minute, without reading every asset.
CREATE INDEX IF NOT EXISTS idx_assets_unindexed ON assets(created_at) WHERE indexed_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assets_unplaced ON assets(id) WHERE gps_lat IS NOT NULL AND place_checked_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assets_unhashed ON assets(phash_tried_at) WHERE phash IS NULL AND deleted_at IS NULL AND status = 'ready';
