-- 0012: look-alike hashes now average the thumbnail down to 9×8 in our own code (catalog/phash.ts
-- areaGrey) instead of Cloudflare Images' resampler, so the NAS agent and the Worker agree (spike 5a).
-- Earlier hashes aren't comparable: clear them and the pairs they found; the sweep hashes everything
-- again. Dismissed pairs are kept, as in 0006. `phash_tried_at` stops a photo whose thumbnail can't be
-- hashed from being retried every minute.
UPDATE assets SET phash = NULL;
DELETE FROM asset_hash_bands;
DELETE FROM similar_pairs WHERE dismissed = 0;
ALTER TABLE assets ADD COLUMN phash_tried_at TEXT;
