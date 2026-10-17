-- 0010: when a photo's GPS was last looked up against the place list (GeoNames), so the sweep
-- fills in city, region and country for older photos once.
ALTER TABLE assets ADD COLUMN place_checked_at TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_place_check ON assets(place_checked_at) WHERE gps_lat IS NOT NULL;
