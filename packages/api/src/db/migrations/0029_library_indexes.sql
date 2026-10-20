-- 0029: the Library at scale (research/SCALE-1.4M-v1.md in cf-dam-docs). Both sorts read a page off an
-- index instead of sorting the whole catalog. Partial: the Library never shows deleted photos or ones
-- still uploading, and its queries say so in exactly these words, so SQLite can use them.
CREATE INDEX IF NOT EXISTS idx_assets_library_taken ON assets(COALESCE(captured_at, created_at) DESC, id DESC) WHERE deleted_at IS NULL AND status != 'uploading';
CREATE INDEX IF NOT EXISTS idx_assets_library_added ON assets(created_at DESC, id DESC) WHERE deleted_at IS NULL AND status != 'uploading';
