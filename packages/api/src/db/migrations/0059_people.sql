-- 0059: people named by hand (plans/PLAN-FN-v2.md FN1, in cf-dam-docs). A person is a name the photographer gives;
-- a photo is tagged with people like it is with keywords. No face recognition here: nothing biometric is stored.
-- Names read from files (XMP PersonInImage, MWG face region names) are tagged the same way, marked 'file'.
CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  -- Lower case without accents, for finding a name however it's typed.
  name_key TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  is_child INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX people_name ON people (name_key);

CREATE TABLE asset_people (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  -- hand, or file (read from the photo's own metadata)
  how TEXT NOT NULL DEFAULT 'hand',
  created_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, person_id)
);
CREATE INDEX asset_people_person ON asset_people (person_id);

-- Naming people: admins and editors. Viewers see the names on photos they can see.
INSERT OR IGNORE INTO permissions (id, description) VALUES ('people:manage', 'Name people in photos, rename, merge and delete them');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role-admin', 'people:manage');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role-editor', 'people:manage');
