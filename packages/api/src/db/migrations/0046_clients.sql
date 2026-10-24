-- 0046: clients (plans/PLAN-C-v2.md, phase C2; catalog/client-records.ts). A client is a person, a couple, a
-- family or a company: contact details and notes, and the client logins (users with the Client role) that
-- belong to them. Being linked to a client grants nothing: galleries are still shared per link.
CREATE TABLE IF NOT EXISTS clients (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  company     TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  -- null: no preference; galleries made for them can use it.
  language    TEXT,
  notes       TEXT NOT NULL DEFAULT '',
  -- name, company, emails and phone folded (lower case, no accents) for search: D1's LIKE folds ASCII only.
  search      TEXT NOT NULL DEFAULT '',
  -- set when marked a past client: hidden from the list by default.
  past_at     TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(past_at, name);

-- A client login belongs to at most one client. Better Auth's users table stays untouched, and backups load
-- this after both tables it points at.
CREATE TABLE IF NOT EXISTS client_people (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  linked_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_people_client ON client_people(client_id);

-- A client's history on their page (target_type 'client'), without scanning the log.
CREATE INDEX IF NOT EXISTS idx_activity_log_target ON activity_log(target_type, target_id, created_at);

-- Client details are personal data: administrators only.
INSERT OR IGNORE INTO permissions (id, description) VALUES ('clients:manage', 'See and edit clients, their contact details and history');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role-admin', 'clients:manage');
