-- 0004: culling flags for the library.
-- 'pick' or 'reject'; NULL means unflagged.
ALTER TABLE assets ADD COLUMN flag TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_flag ON assets(flag);
CREATE INDEX IF NOT EXISTS idx_assets_rating ON assets(rating);
CREATE INDEX IF NOT EXISTS idx_assets_lens ON assets(lens);
