-- 0061: what a buyer sees a bought photo as (plans/PLAN-FN-GALLERY-v3.md §3, in cf-dam-docs). n is the photo's place
-- in the gallery when it was bought; label is its real filename only when the gallery showed filenames, otherwise null
-- and the buyer sees "Photo 42" and gets "smith-wedding-042.jpg". The filename column stays for the team.
ALTER TABLE order_items ADD COLUMN n INTEGER;
ALTER TABLE order_items ADD COLUMN label TEXT;
