-- 0063: people and groups in client galleries (plans/PLAN-FN-GALLERY-v3.md G1, in cf-dam-docs). A group is a name
-- and a list of people, and belongs to a client ("Bride's family"). A gallery can show the client's own invited
-- people chips for the groups and people its settings list, under the label set there (catalog/gallery-people.ts).

-- Never sent to any client, in any gallery, whatever its settings say.
ALTER TABLE people ADD COLUMN hidden_from_clients INTEGER NOT NULL DEFAULT 0;

CREATE TABLE people_groups (
  id INTEGER PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX people_groups_name ON people_groups (client_id, name_key);

CREATE TABLE people_group_members (
  group_id INTEGER NOT NULL REFERENCES people_groups(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, person_id)
);
CREATE INDEX people_group_members_person ON people_group_members (person_id);

-- Off by default: a gallery shows nobody until the photographer says so.
ALTER TABLE shares ADD COLUMN people_shown INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shares ADD COLUMN children_named INTEGER NOT NULL DEFAULT 0;

-- What a gallery lists: a person or a group, each with the name shown there ("Anna", not "Anna Smith").
CREATE TABLE share_people (
  share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES people_groups(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  CHECK ((person_id IS NULL) <> (group_id IS NULL))
);
CREATE INDEX share_people_share ON share_people (share_id, position);
CREATE UNIQUE INDEX share_people_one_person ON share_people (share_id, person_id) WHERE person_id IS NOT NULL;
CREATE UNIQUE INDEX share_people_one_group ON share_people (share_id, group_id) WHERE group_id IS NOT NULL;
CREATE INDEX share_people_person ON share_people (person_id);
CREATE INDEX share_people_group ON share_people (group_id);
