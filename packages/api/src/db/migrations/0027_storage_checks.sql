-- 0027: storage checks (plans/PLAN-S-v1.md in cf-dam-docs, slice S1). Each original outside a NAS is
-- asked about once a cycle: still there, same size, same etag, same SHA-256 where the store keeps one.
-- check_due_at orders the work (NULL, never checked, first); checked_at is when it last happened.
ALTER TABLE asset_locations ADD COLUMN checked_at TEXT;
ALTER TABLE asset_locations ADD COLUMN check_due_at TEXT;
-- ok, missing, changed or unreadable (couldn't ask: credentials, network).
ALTER TABLE asset_locations ADD COLUMN check_result TEXT;
ALTER TABLE asset_locations ADD COLUMN check_detail TEXT;
-- Partial: NAS originals are the agent's to watch, and would otherwise sit unchecked at the front.
CREATE INDEX IF NOT EXISTS idx_asset_locations_check_due ON asset_locations(check_due_at) WHERE storage_class != 'NAS';
CREATE INDEX IF NOT EXISTS idx_asset_locations_check_result ON asset_locations(check_result);
