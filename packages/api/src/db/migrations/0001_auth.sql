-- 0001: accounts, sessions, roles, permissions, API keys, settings, activity log.
--
-- Conventions for every cf-dam table:
--   * Timestamps are ISO-8601 UTC TEXT. Better Auth writes its `date` fields that way on SQLite
--     (`supportsDates: false`), and one convention everywhere keeps comparisons and sorting right.
--   * Booleans are INTEGER 0/1 (Better Auth's `supportsBooleans: false` on SQLite).
--   * Statements end with `;` at the end of a line; the runtime migrator splits on that.
--   * Every statement is idempotent, because two isolates can race to apply the same migration.

-- Better Auth core: users, credentials and OAuth links, sessions, single-use verification values.
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL UNIQUE,
  email_verified      INTEGER NOT NULL DEFAULT 0,
  image               TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  last_login_at       TEXT,
  two_factor_enabled  INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account (
  id                        TEXT PRIMARY KEY,
  user_id                   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id                TEXT NOT NULL,
  provider_id               TEXT NOT NULL,
  access_token              TEXT,
  refresh_token             TEXT,
  access_token_expires_at   TEXT,
  refresh_token_expires_at  TEXT,
  scope                     TEXT,
  id_token                  TEXT,
  password                  TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_user_id ON account(user_id);
CREATE INDEX IF NOT EXISTS idx_account_provider ON account(provider_id, account_id);

CREATE TABLE IF NOT EXISTS session (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id);
CREATE INDEX IF NOT EXISTS idx_session_expires_at ON session(expires_at);

CREATE TABLE IF NOT EXISTS verification (
  id          TEXT PRIMARY KEY,
  identifier  TEXT NOT NULL,
  value       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);

-- Better Auth twoFactor plugin. `failed_verification_count` must be NOT NULL DEFAULT 0: the
-- lockout increments it in SQL, and NULL + 1 stays NULL, so a nullable column never locks.
CREATE TABLE IF NOT EXISTS two_factor (
  id                         TEXT PRIMARY KEY,
  user_id                    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret                     TEXT NOT NULL,
  backup_codes               TEXT NOT NULL,
  verified                   INTEGER NOT NULL DEFAULT 1,
  failed_verification_count  INTEGER NOT NULL DEFAULT 0,
  locked_until               TEXT
);
CREATE INDEX IF NOT EXISTS idx_two_factor_user_id ON two_factor(user_id);
CREATE INDEX IF NOT EXISTS idx_two_factor_secret ON two_factor(secret);

-- Roles and permissions. Better Auth owns identity; authorization is ours.
CREATE TABLE IF NOT EXISTS roles (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  is_system    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id           TEXT PRIMARY KEY,
  description  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id  TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);

-- API keys: only the SHA-256 of the key is stored. `prefix` is the first characters, shown in
-- the UI so people can tell keys apart. `scopes` is a JSON array of permission ids; a key never
-- grants more than its owner's roles do.
CREATE TABLE IF NOT EXISTS api_keys (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  scopes        TEXT NOT NULL,
  expires_at    TEXT,
  last_used_at  TEXT,
  revoked_at    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  details      TEXT,
  ip_address   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);

-- Seed: permissions, system roles, and what each role grants.
INSERT OR IGNORE INTO permissions (id, description) VALUES
  ('assets:read',       'Browse, search and view assets'),
  ('assets:upload',     'Upload and import assets'),
  ('assets:edit',       'Edit asset metadata, tags and albums'),
  ('assets:delete',     'Delete assets'),
  ('ai:run',            'Run AI analysis'),
  ('lifecycle:manage',  'Move originals between storage tiers and restore them'),
  ('sources:manage',    'Register and manage NAS agents and storage connections'),
  ('apikeys:manage',    'Create and revoke your own API keys'),
  ('users:manage',      'Create users, change roles, deactivate accounts'),
  ('settings:manage',   'Change system settings');

INSERT OR IGNORE INTO roles (id, name, label, description, is_system, created_at) VALUES
  ('role-admin',  'admin',  'Administrator', 'Full access, including users and settings', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('role-editor', 'editor', 'Editor',        'Upload, organise and edit assets',          1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('role-viewer', 'viewer', 'Viewer',        'Browse and search assets',                  1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'role-admin', id FROM permissions;

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('role-editor', 'assets:read'),
  ('role-editor', 'assets:upload'),
  ('role-editor', 'assets:edit'),
  ('role-editor', 'assets:delete'),
  ('role-editor', 'ai:run'),
  ('role-editor', 'apikeys:manage'),
  ('role-viewer', 'assets:read'),
  ('role-viewer', 'apikeys:manage');

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('auth.registration_open', 'false', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
