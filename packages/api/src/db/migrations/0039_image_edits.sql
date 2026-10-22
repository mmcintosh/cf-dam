-- 0039: rotate, mirror and crop without touching the original (catalog/edits.ts). The edit as JSON,
-- and when it last changed (image addresses carry it, so browsers fetch the edited picture).
ALTER TABLE assets ADD COLUMN edit TEXT;
ALTER TABLE assets ADD COLUMN edited_at TEXT;
