-- 0065: face boxes, detection only (plans/PLAN-FN2-v2.md in cf-dam-docs). A face is a box and a score on the unedited,
-- upright preview; nothing else is kept (no facial points, no face prints, no matching). Boxes come from the helper or a
-- browser tab running BlazeFace, or from a file's MWG face regions. Naming a face tags the photo with the person, as
-- FN1 does by hand. Off until someone turns Find faces on (settings 'faces.on'); 'faces.epoch' changes with every
-- switch, and a box sent under another epoch is refused. Remove all sets 'faces.remove_before' to the epoch, and the sweep
-- deletes detector boxes older than it.
CREATE TABLE faces (
  id INTEGER PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  -- Per-mille (0–1000) of the unedited, upright preview the box was found on.
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  -- Per-mille; null for boxes from files.
  score INTEGER,
  -- The detector and its setting, e.g. 'blazeface-fr-1/g23/t60'; null for boxes from files.
  model TEXT,
  -- detector, file, or hand (drawn by hand: not built yet, PLAN-FN2-v2 §13).
  source TEXT NOT NULL,
  -- The preview it was found on ("width x height : bytes", as assets.faces_frame): a box is shown only on that preview.
  frame TEXT,
  epoch INTEGER NOT NULL,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  -- Not someone to name (a passer-by, a poster), or a deleted person's face: kept so re-detection doesn't offer it again.
  set_aside INTEGER NOT NULL DEFAULT 0,
  named_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX faces_asset ON faces (asset_id);
CREATE INDEX faces_person ON faces (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX faces_unnamed ON faces (asset_id) WHERE person_id IS NULL AND set_aside = 0;
CREATE INDEX faces_detector_epoch ON faces (epoch) WHERE source = 'detector';

-- Whether faces have been looked for: null = not yet; 'done'; 'skip' (a video, or nothing to look at); 'failed'.
ALTER TABLE assets ADD COLUMN faces_state TEXT;
-- The preview the boxes belong to, "width x height : bytes" of the unedited preview. A new preview resets the state.
ALTER TABLE assets ADD COLUMN faces_frame TEXT;
ALTER TABLE assets ADD COLUMN faces_tries INTEGER NOT NULL DEFAULT 0;
-- The epoch of the last look, so Remove all resets only what was looked at before it.
ALTER TABLE assets ADD COLUMN faces_epoch INTEGER;
-- Handed to a helper or a browser tab; another isn't given it for ten minutes.
ALTER TABLE assets ADD COLUMN faces_claimed_at TEXT;
UPDATE assets SET faces_state = 'skip' WHERE mime_type LIKE 'video/%';
CREATE INDEX assets_faces_todo ON assets (created_at DESC, id) WHERE faces_state IS NULL AND deleted_at IS NULL;

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('faces.on', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('faces.epoch', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
