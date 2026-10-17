-- 0007: AI review. Suggestions live in ai_* columns and never overwrite what a person wrote; AI tags go
-- into asset_tags with source 'ai'. The full-text index gains an `ai` column (the model's description),
-- so it is rebuilt; the sweep re-indexes every asset missing from it.
ALTER TABLE assets ADD COLUMN ai_status TEXT;
ALTER TABLE assets ADD COLUMN ai_model TEXT;
ALTER TABLE assets ADD COLUMN ai_analyzed_at TEXT;
ALTER TABLE assets ADD COLUMN ai_alt TEXT;
ALTER TABLE assets ADD COLUMN ai_caption TEXT;
ALTER TABLE assets ADD COLUMN ai_description TEXT;
ALTER TABLE assets ADD COLUMN ai_quality TEXT;
ALTER TABLE assets ADD COLUMN ai_people INTEGER;
ALTER TABLE assets ADD COLUMN ai_neurons REAL;
ALTER TABLE assets ADD COLUMN ai_error TEXT;
ALTER TABLE assets ADD COLUMN ai_started_at TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_ai_status ON assets(ai_status);

DROP TABLE IF EXISTS assets_fts;
CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
  asset_id UNINDEXED,
  filename,
  title,
  caption,
  tags,
  camera,
  place,
  ai,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('ai.enabled', 'true', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ai.auto', 'true', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ai.model', '@cf/mistralai/mistral-small-3.1-24b-instruct', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ai.context', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
