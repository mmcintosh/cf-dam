-- 0042: client accounts (catalog/clients.ts). A client is a person with only the Client role: they
-- sign in and see the galleries (share links) they were invited to, nothing else. Membership is per
-- link, so each client gets that link's downloads, watermark and expiry; signed in, they skip its
-- password, and their favourites belong to them (a visitor row with their user id) on any device.
INSERT OR IGNORE INTO roles (id, name, label, description, is_system, created_at) VALUES
  ('role-client', 'client', 'Client', 'Sees only the client galleries they were invited to', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE IF NOT EXISTS share_members (
  share_id    TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (share_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_share_members_user ON share_members(user_id);

-- One-time links a photographer sends a new client to choose their password. Only the hash is kept;
-- a new invite for the same person replaces the old one.
CREATE TABLE IF NOT EXISTS client_invites (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

ALTER TABLE share_visitors ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_share_visitors_member ON share_visitors(share_id, user_id) WHERE user_id IS NOT NULL;
