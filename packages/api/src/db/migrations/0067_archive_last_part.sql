-- An archive upload is given up a week after its last part, not a week after it began (PLAN-HELPER-ARCHIVE-v2 A.3):
-- a big file archived a few hours a night can take longer than a week and still be moving.
ALTER TABLE archive_uploads ADD COLUMN last_part_at TEXT;
