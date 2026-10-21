-- 0033: an agent can be connected again to its own entry (plans/PLAN-S-v1.md in cf-dam-docs, slice S3b).
-- After a restore from a backup, agents' keys are gone (backups leave them out); the entry, its folders
-- and its photos are back. An agent pairing again says which entry it was, so the person approving can
-- give it that entry back, and the agent carries on with its file list instead of starting over.
ALTER TABLE pairing_requests ADD COLUMN previous_source_id TEXT;
