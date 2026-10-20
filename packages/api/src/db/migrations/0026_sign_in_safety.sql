-- 0026: logins in front of production (plans/PLAN-L-v1.md in cf-dam-docs).
-- Per-account lockout for passwords: wrong passwords in a row, and until when password sign-in is
-- refused. A passkey still signs in while it's locked.
ALTER TABLE users ADD COLUMN failed_sign_ins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
-- Set when an admin creates a person or sets a temporary password: it must be changed before
-- anything else.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

-- A viewer browses; programs acting for them have no use. Keys they made stop being manageable by
-- them, and still can't do more than read.
DELETE FROM role_permissions WHERE role_id = 'role-viewer' AND permission_id = 'apikeys:manage';

-- The activity page: filter by person or kind, newest first.
INSERT OR IGNORE INTO permissions (id, description) VALUES ('activity:read', 'See who did what, and when');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role-admin', 'activity:read');
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action, created_at);
