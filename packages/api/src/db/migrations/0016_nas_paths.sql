-- 0016: one present file per path on a NAS agent's connection. Two agent requests for the same new
-- file at once could each create an asset; this index makes the second fail and look again. A path
-- may still have missing rows (a photo deleted, then another saved under its name): those keep the
-- old photo's catalogue entry, apart from the new one.
-- Any duplicates already there: keep the newest row present, mark the others missing.
UPDATE asset_locations SET state = 'missing', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE storage_class = 'NAS' AND state = 'present' AND rowid NOT IN (
  SELECT MAX(rowid) FROM asset_locations WHERE storage_class = 'NAS' AND state = 'present' GROUP BY connection_id, key
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_locations_nas_present ON asset_locations(connection_id, key) WHERE storage_class = 'NAS' AND state = 'present';
