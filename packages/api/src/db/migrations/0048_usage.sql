-- 0048: what this archive used of paid services, per calendar month (lib/images.ts). Cloudflare Images bills each
-- unique transformation; counting every image it produces gives an upper bound to watch, and an alert above a
-- monthly threshold (settings key images.alert_at).
CREATE TABLE IF NOT EXISTS usage (
  month  TEXT NOT NULL,
  kind   TEXT NOT NULL,
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, kind)
);
