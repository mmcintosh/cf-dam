-- 0008: the keyword tree and colour labels.
--
-- Tags become a tree, like Lightroom's keyword list. A name is no longer unique on its own (Smith can
-- sit under People and under Places); the full path is. `path` is the lower-cased key
-- ('places|europe|norway|bergen'), `full_path` the display form ('Places|Europe|Norway|Bergen').
-- SQLite can't drop the old UNIQUE(name), so the table is rebuilt. Dropping a table runs an implicit
-- DELETE that would cascade into asset_tags, so asset_tags is copied aside first and put back.
PRAGMA defer_foreign_keys = true;
CREATE TABLE asset_tags_keep AS SELECT * FROM asset_tags;
CREATE TABLE tags_next (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  parent_id          TEXT REFERENCES tags(id) ON DELETE CASCADE,
  path               TEXT NOT NULL UNIQUE,
  full_path          TEXT NOT NULL,
  include_on_export  INTEGER NOT NULL DEFAULT 1,
  export_parents     INTEGER NOT NULL DEFAULT 1,
  export_synonyms    INTEGER NOT NULL DEFAULT 1,
  synonyms           TEXT NOT NULL DEFAULT '[]',
  created_at         TEXT NOT NULL
);
INSERT INTO tags_next (id, name, parent_id, path, full_path, created_at)
  SELECT id, replace(name, '|', '/'), NULL, lower(replace(name, '|', '/')), replace(name, '|', '/'), created_at FROM tags;
DROP TABLE tags;
ALTER TABLE tags_next RENAME TO tags;
CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name COLLATE NOCASE);
INSERT OR IGNORE INTO asset_tags SELECT * FROM asset_tags_keep;
DROP TABLE asset_tags_keep;

-- Colour labels: red, yellow, green, blue, purple. Their display names are a setting.
ALTER TABLE assets ADD COLUMN label TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_label ON assets(label);
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('labels.names', '{"red":"Red","yellow":"Yellow","green":"Green","blue":"Blue","purple":"Purple"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
