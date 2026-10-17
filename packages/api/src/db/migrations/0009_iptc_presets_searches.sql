-- 0009: IPTC Core fields, metadata presets, saved searches, and OCR text from AI review.
ALTER TABLE assets ADD COLUMN headline TEXT;
ALTER TABLE assets ADD COLUMN creator TEXT;
ALTER TABLE assets ADD COLUMN creator_title TEXT;
ALTER TABLE assets ADD COLUMN credit TEXT;
ALTER TABLE assets ADD COLUMN source TEXT;
ALTER TABLE assets ADD COLUMN copyright TEXT;
ALTER TABLE assets ADD COLUMN usage_terms TEXT;
ALTER TABLE assets ADD COLUMN copyright_url TEXT;
ALTER TABLE assets ADD COLUMN contact_email TEXT;
ALTER TABLE assets ADD COLUMN contact_phone TEXT;
ALTER TABLE assets ADD COLUMN contact_url TEXT;
ALTER TABLE assets ADD COLUMN job_id TEXT;
ALTER TABLE assets ADD COLUMN instructions TEXT;
ALTER TABLE assets ADD COLUMN sublocation TEXT;
ALTER TABLE assets ADD COLUMN city TEXT;
ALTER TABLE assets ADD COLUMN state TEXT;
ALTER TABLE assets ADD COLUMN country TEXT;
ALTER TABLE assets ADD COLUMN country_code TEXT;
-- Where city/state/country came from: 'file', 'user', or 'gps' (looked up from the coordinates).
ALTER TABLE assets ADD COLUMN location_source TEXT;
ALTER TABLE assets ADD COLUMN ai_text TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_country ON assets(country);
CREATE INDEX IF NOT EXISTS idx_assets_city ON assets(city);
CREATE INDEX IF NOT EXISTS idx_assets_creator ON assets(creator);

-- What earlier uploads already read from their files (kept in the metadata JSON until now).
UPDATE assets SET
  creator = COALESCE(json_extract(metadata, '$.creator'), json_extract(metadata, '$.Byline')),
  copyright = COALESCE(json_extract(metadata, '$.copyright'), json_extract(metadata, '$.CopyrightNotice')),
  headline = json_extract(metadata, '$.Headline'),
  credit = json_extract(metadata, '$.Credit'),
  source = json_extract(metadata, '$.Source'),
  job_id = json_extract(metadata, '$.OriginalTransmissionReference'),
  instructions = json_extract(metadata, '$.SpecialInstructions'),
  sublocation = json_extract(metadata, '$.Sublocation'),
  city = json_extract(metadata, '$.City'),
  state = json_extract(metadata, '$.State'),
  country = json_extract(metadata, '$.Country'),
  country_code = json_extract(metadata, '$.CountryCode'),
  location_source = CASE WHEN json_extract(metadata, '$.City') IS NOT NULL OR json_extract(metadata, '$.Country') IS NOT NULL THEN 'file' END
WHERE metadata IS NOT NULL AND json_valid(metadata);

-- Named sets of fields applied in one go, e.g. "My copyright". `fields` is JSON: {copyright: "…", creator: "…"}.
CREATE TABLE IF NOT EXISTS metadata_presets (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  fields            TEXT NOT NULL,
  apply_to_uploads  INTEGER NOT NULL DEFAULT 0,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- A library filter with a name, shown in the sidebar like an album (smart albums).
CREATE TABLE IF NOT EXISTS saved_searches (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  query       TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
