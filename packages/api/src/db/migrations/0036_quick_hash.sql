-- 0036: exact duplicates for every photo, not only uploads. A helper reads only the start and end of
-- a file (its quick fingerprint: SHA-256 of the size, the first MiB and the last MiB), so its photos
-- have no whole-file SHA-256 until they're archived. The quick fingerprint is now kept on the photo
-- too: the helper's from its location, an upload's from the browser. Two photos are the same file when
-- their quick fingerprints match, or, for uploads from before this, their SHA-256s do. The content key
-- is COALESCE(quick_hash, sha256); code uses the same expression so this index serves it.
ALTER TABLE assets ADD COLUMN quick_hash TEXT;
DROP INDEX IF EXISTS idx_assets_live_sha256;
CREATE INDEX IF NOT EXISTS idx_assets_live_content ON assets (COALESCE(quick_hash, sha256), created_at)
  WHERE deleted_at IS NULL AND COALESCE(quick_hash, sha256) IS NOT NULL;
-- Photos a helper indexed before this get theirs from their locations in the background (the sweep's
-- fingerprint stage, catalog/duplicates.ts): 72 s in one statement at 1.4 million, over D1's 30 s.
-- The value is how far through asset_locations (by rowid) it has got; the row goes when it's done.
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('quick_hash.fill', '0', '2026-10-22T00:00:00.000Z');
