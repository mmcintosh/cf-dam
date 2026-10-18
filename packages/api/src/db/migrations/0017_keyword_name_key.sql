-- 0017: a keyword's own name as a lower-case key, for "the keyword called Smith, wherever it is".
-- Matching by name used COLLATE NOCASE, which only folds A–Z: 'Österreich' never matched
-- 'österreich'. The key is filled with lower() here and redone properly (in JS) by repair 0018.
ALTER TABLE tags ADD COLUMN name_key TEXT NOT NULL DEFAULT '';
UPDATE tags SET name_key = lower(name);
CREATE INDEX IF NOT EXISTS idx_tags_name_key ON tags(name_key);
DROP INDEX IF EXISTS idx_tags_name;
