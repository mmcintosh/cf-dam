-- 0052: library facets from TypeSafe's Jev (plans/PLAN-F-v2.md; catalog/jev-facets.ts), beside the Workers AI review.
-- facet_status: null (never asked), 'queued', 'running', 'done', 'failed' (3 tries), 'skipped' (no preview, or an
-- image Jev refuses). facet_people: 'none', 'one', 'two_to_five', 'six_or_more', 'some' (sure there's a person, not
-- how many), or null (unsure, or not asked).
-- facet_tags: the yes/no facets Jev is sure of (question ids, JSON); facet_scores: every probability, so thresholds
-- can change without asking again. They are not keywords: they stay out of asset_tags.
ALTER TABLE assets ADD COLUMN facet_status TEXT;
ALTER TABLE assets ADD COLUMN facet_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN facet_started_at TEXT;
ALTER TABLE assets ADD COLUMN facet_at TEXT;
ALTER TABLE assets ADD COLUMN facet_error TEXT;
ALTER TABLE assets ADD COLUMN facet_people TEXT;
ALTER TABLE assets ADD COLUMN facet_setting TEXT;
ALTER TABLE assets ADD COLUMN facet_medium TEXT;
ALTER TABLE assets ADD COLUMN facet_tags TEXT;
ALTER TABLE assets ADD COLUMN facet_scores TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_facet_status ON assets(facet_status, created_at) WHERE facet_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_facet_people ON assets(facet_people) WHERE facet_people IS NOT NULL;
