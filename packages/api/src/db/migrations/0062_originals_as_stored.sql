-- 0062: originals sent to clients are cleaned of names, captions, keywords and places (storage/clean.ts; plans/
-- PLAN-FN-GALLERY-v3.md §3, in cf-dam-docs). A gallery can send them exactly as stored instead.
ALTER TABLE shares ADD COLUMN originals_as_stored INTEGER NOT NULL DEFAULT 0;
