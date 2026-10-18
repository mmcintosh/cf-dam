-- AI analysis counts its tries (review B7). Each try is billed, so a photo the model has failed on three
-- times isn't queued again by a backfill, and one left "running" by a run that died goes back to the
-- queue only while it has tries left. Choosing photos and queueing them on purpose starts the count again.
ALTER TABLE assets ADD COLUMN ai_attempts INTEGER NOT NULL DEFAULT 0;
UPDATE assets SET ai_attempts = 1 WHERE ai_status IN ('done', 'failed');
