-- 0049: restores that move on (plans/PLAN-C4-v2.md, C4a). A location being restored is re-read when its
-- next_check_at comes, not in updated_at order, which doesn't change while S3 is still working: before, the same
-- 50 rows were read every minute and a gone object stayed 'restoring' for ever.
ALTER TABLE asset_locations ADD COLUMN next_check_at TEXT;
CREATE INDEX IF NOT EXISTS idx_asset_locations_restoring ON asset_locations(state, next_check_at);
