-- 0044: an alert's sentence as a translation key and its values (packages/i18n), so each reader sees it
-- in their own language. `message` stays, in English, for older alerts and for the activity log.
ALTER TABLE alerts ADD COLUMN text TEXT;
