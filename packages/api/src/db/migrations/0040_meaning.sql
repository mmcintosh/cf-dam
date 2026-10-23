-- 0040: search by meaning (catalog/meaning.ts). When each photo's vector was last checked (NULL: check
-- it; indexing sets that), and the text it was made from, so unchanged text costs no AI call.
ALTER TABLE assets ADD COLUMN meaning_at TEXT;
ALTER TABLE assets ADD COLUMN meaning_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_unmeant ON assets (created_at) WHERE meaning_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assets_meant_gone ON assets (id) WHERE deleted_at IS NOT NULL AND meaning_hash IS NOT NULL;
