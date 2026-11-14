-- "Try them again" on the Computers and NAS page (PLAN-HELPER-ARCHIVE-v2 A.5): asked here, passed to the helper with its
-- next heartbeat, then cleared.
ALTER TABLE sources ADD COLUMN archive_retry_at TEXT;

-- A person's choice for files the helper held because their bytes changed without their date moving (A.6): 'archive'
-- (as they are now) or 'keep' (the copy already in the bucket), passed with the next heartbeat, then cleared.
ALTER TABLE sources ADD COLUMN archive_held_choice TEXT;
