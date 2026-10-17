-- 0015: folders on drives that come and go (USB disks, unmounted shares). A folder can belong to a
-- volume (macOS volume UUID, Windows volume id), recorded with where it was mounted when added, so the
-- agent finds it again at a new mount point or drive letter. While it is unreachable the folder is
-- offline: its photos are still in the catalogue, marked offline, never missing.
ALTER TABLE source_roots ADD COLUMN volume_id TEXT;
ALTER TABLE source_roots ADD COLUMN volume_label TEXT;
ALTER TABLE source_roots ADD COLUMN volume_path TEXT;
ALTER TABLE source_roots ADD COLUMN offline_since TEXT;
-- The volumes the agent can see right now (JSON: [{id, label, path, removable}]).
ALTER TABLE sources ADD COLUMN volumes TEXT NOT NULL DEFAULT '[]';
