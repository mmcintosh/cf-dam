-- 0058: gallery emails (plans/PLAN-E-v2.md §4). Per member: when they turned this gallery's emails off, and which
-- closing date they were reminded about (a new date allows a new reminder). Per gallery: when its members were last
-- emailed (at most every six hours) and when "finished choosing" was last sent (at most hourly).
ALTER TABLE share_members ADD COLUMN emails_off_at TEXT;
ALTER TABLE share_members ADD COLUMN reminded_for TEXT;
ALTER TABLE shares ADD COLUMN members_emailed_at TEXT;
ALTER TABLE shares ADD COLUMN done_mailed_at TEXT;
