-- An agent's key belongs to its source, not to the person who approved the pairing (review B19).
-- Kept as an API key of theirs, it died with them: deleting or deactivating that person, or revoking
-- it among "their" keys on /me, silently cut the agent off. Disconnecting the agent is what revokes it.
ALTER TABLE sources ADD COLUMN key_hash TEXT;
UPDATE sources SET key_hash = (SELECT k.key_hash FROM api_keys k WHERE k.id = sources.api_key_id AND k.revoked_at IS NULL)
  WHERE api_key_id IS NOT NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_key_hash ON sources(key_hash);
DELETE FROM api_keys WHERE id IN (SELECT api_key_id FROM sources WHERE api_key_id IS NOT NULL);
UPDATE sources SET api_key_id = NULL;

-- An approval claims its pairing first, so two people approving one code at once make one agent (B17).
ALTER TABLE pairing_requests ADD COLUMN claimed_at TEXT;
