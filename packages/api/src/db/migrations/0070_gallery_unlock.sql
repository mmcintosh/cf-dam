-- 0070: wrong gallery passwords counted per gallery, from every address (routes/gallery.ts). Every tenth in a row
-- holds that gallery's password for a while; the right one starts the count again.
ALTER TABLE shares ADD COLUMN unlock_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shares ADD COLUMN unlock_held_until TEXT;
