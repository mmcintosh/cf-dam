-- 0054: a storage connection's last test (plans/PLAN-ST-v2.md in cf-dam-docs), shown on the Storage page and the
-- connection's own page: when, whether it worked, and why not.
ALTER TABLE storage_connections ADD COLUMN tested_at TEXT;
ALTER TABLE storage_connections ADD COLUMN test_ok INTEGER;
ALTER TABLE storage_connections ADD COLUMN test_message TEXT;
