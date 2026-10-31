-- 0064: the couple suggests names (plans/PLAN-G2-v2.md, in cf-dam-docs). A gallery's client's own invited people
-- can say who is on its photos; nothing is tagged until the photographer accepts it in Names to check
-- (catalog/name-suggestions.ts). Only waiting suggestions are kept: accepting or rejecting deletes them.

-- 1: the couple can suggest names (only while people are shown too). Existing galleries stay off.
ALTER TABLE shares ADD COLUMN suggestions_on INTEGER NOT NULL DEFAULT 0;
-- When the photographer last set it; null: never, so turning people on the first time turns it on too.
ALTER TABLE shares ADD COLUMN suggestions_set_at TEXT;
-- The last "names suggested" line in Activity and email, at most one an hour per gallery.
ALTER TABLE shares ADD COLUMN suggestions_noted_at TEXT;

CREATE TABLE name_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- What the couple see and send back: random, so it says nothing about the rest of the archive.
  public_id TEXT NOT NULL UNIQUE,
  share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The person behind a chip the couple ticked; if they're deleted the suggestion stays as its text.
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  -- As typed (cleaned), or the chip's label at the time: never a person's full name.
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX name_suggestions_one ON name_suggestions (share_id, asset_id, user_id, name_key);
CREATE INDEX name_suggestions_share ON name_suggestions (share_id, name_key);
CREATE INDEX name_suggestions_asset ON name_suggestions (asset_id);
CREATE INDEX name_suggestions_user ON name_suggestions (user_id);
CREATE INDEX name_suggestions_person ON name_suggestions (person_id);
