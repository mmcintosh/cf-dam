-- 0006: look-alike hashes gained a dead zone (catalog/phash.ts DEAD_ZONE), so earlier hashes aren't
-- comparable. Clear them and the pairs found with them; the sweep fingerprints everything again.
-- Pairs someone dismissed as "not duplicates" are kept: re-finding them leaves them dismissed.
UPDATE assets SET phash = NULL;
DELETE FROM asset_hash_bands;
DELETE FROM similar_pairs WHERE dismissed = 0;
