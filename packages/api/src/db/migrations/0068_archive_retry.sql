-- "Try them again" on the Computers and NAS page (PLAN-HELPER-ARCHIVE-v2 A.5): asked here, passed to the helper with its
-- next heartbeat, then cleared.
ALTER TABLE sources ADD COLUMN archive_retry_at TEXT;
