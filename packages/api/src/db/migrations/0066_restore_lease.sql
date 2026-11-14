-- 0066: a restore's lease names the run holding it (plans/PLAN-BACKUP-RESTORE-v2.md in cf-dam-docs). Each group
-- of rows goes in only together with the progress that says so, and only while this run's token is the one
-- stored: a run that outlived its lease can't write over the run that took the restore on.
ALTER TABLE restore_jobs ADD COLUMN lease_token TEXT;
