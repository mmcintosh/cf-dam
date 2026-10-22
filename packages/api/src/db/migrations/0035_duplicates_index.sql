-- 0035: the exact-duplicates page at scale. Grouping every live photo's SHA-256 read each row for
-- deleted_at and created_at: 25 s for the first page at 1.4 million photos (scale/). From this index
-- alone it takes 0.4 s, and the count of groups the same.
CREATE INDEX IF NOT EXISTS idx_assets_live_sha256 ON assets (sha256, created_at) WHERE deleted_at IS NULL AND sha256 IS NOT NULL;
