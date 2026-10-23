-- 0045: the language an AI review was written in (packages/i18n codes). NULL for reviews from before,
-- which were all English.
ALTER TABLE assets ADD COLUMN ai_language TEXT;
