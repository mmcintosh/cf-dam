-- 0041: each person's appearance choices (catalog/preferences.ts): theme, text size, contrast, motion,
-- font, link underlines, thumbnail size. JSON, so a new choice needs no migration.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
