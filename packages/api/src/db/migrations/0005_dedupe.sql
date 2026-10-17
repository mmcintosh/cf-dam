-- 0005: look-alike detection. A 64-bit perceptual hash per photo, split into bands for lookup,
-- and the look-alike pairs found (a < b), which people can dismiss as "not duplicates".
ALTER TABLE assets ADD COLUMN phash TEXT;

CREATE TABLE IF NOT EXISTS asset_hash_bands (
  asset_id  TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  band      INTEGER NOT NULL,
  value     INTEGER NOT NULL,
  PRIMARY KEY (asset_id, band)
);
CREATE INDEX IF NOT EXISTS idx_asset_hash_bands_lookup ON asset_hash_bands(band, value);

CREATE TABLE IF NOT EXISTS similar_pairs (
  a           TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  b           TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  distance    INTEGER NOT NULL,
  dismissed   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE INDEX IF NOT EXISTS idx_similar_pairs_b ON similar_pairs(b);
