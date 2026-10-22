-- 0037: plain photos (sky, fog) pair with a photo of the very same look-alike hash and pixel size
-- (catalog/phash.ts isPlain). This index finds them; 0038 (in code) pairs the ones already hashed.
CREATE INDEX IF NOT EXISTS idx_assets_phash ON assets (phash, width, height) WHERE deleted_at IS NULL AND phash IS NOT NULL;
