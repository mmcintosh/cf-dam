-- 0014: video. Length (seconds), codec and frame rate, from the NAS agent (ExifTool) or the browser.
-- Videos get a poster frame as their preview and a 2×2 contact sheet (rendition 'sheet') for scrubbing.
ALTER TABLE assets ADD COLUMN duration REAL;
ALTER TABLE assets ADD COLUMN video_codec TEXT;
ALTER TABLE assets ADD COLUMN frame_rate REAL;
