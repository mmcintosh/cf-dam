-- 0043: a client gallery link's language (packages/i18n). NULL: each visitor's own (their choice, then
-- their browser); a language code: visitors see the gallery in it unless they choose another.
ALTER TABLE shares ADD COLUMN language TEXT;
