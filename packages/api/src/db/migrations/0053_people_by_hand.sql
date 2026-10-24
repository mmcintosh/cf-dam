-- 0053: correcting Jev's people answer (plans/PLAN-F2-v2.md in cf-dam-docs; catalog/jev-facets.ts).
-- facet_people stays what the Library filters on: Jev's answer, or one set by hand. facet_people_jev keeps Jev's own
-- answer, so going back to it needs no call; facet_people_by is who set it by hand (null: Jev's answer stands). A photo
-- set by hand is never asked again, and an answer arriving for it only updates facet_people_jev.
ALTER TABLE assets ADD COLUMN facet_people_jev TEXT;
ALTER TABLE assets ADD COLUMN facet_people_by TEXT;
UPDATE assets SET facet_people_jev = facet_people WHERE facet_status = 'done';
