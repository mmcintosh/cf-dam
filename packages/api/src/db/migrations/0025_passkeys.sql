-- 0025: passkeys (Better Auth's passkey plugin, mapped to snake_case in auth/auth.ts). A passkey from a
-- password manager or the device signs in on its own: no password, no second code.
CREATE TABLE IF NOT EXISTS passkey (
  id             TEXT PRIMARY KEY,
  name           TEXT,
  public_key     TEXT NOT NULL,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id  TEXT NOT NULL UNIQUE,
  counter        INTEGER NOT NULL,
  device_type    TEXT NOT NULL,
  backed_up      INTEGER NOT NULL,
  transports     TEXT,
  aaguid         TEXT,
  created_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_passkey_user_id ON passkey(user_id);
