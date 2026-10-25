-- 0060: paid digital downloads (plans/PLAN-SELL-v2.md S1, in cf-dam-docs). Clients pay with Stripe Checkout on the
-- photographer's own Stripe account; Stripe's API is the source of truth for payment. Orders outlive galleries and
-- photos (no cascades), and snapshot what was bought.

-- The Stripe restricted key and webhook signing secret, sealed. Left out of catalog backups.
CREATE TABLE payment_secrets (
  name TEXT PRIMARY KEY,
  sealed TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Prices in minor units of the install's currency (cents for USD); NULL: not for sale.
CREATE TABLE price_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  small INTEGER,
  large INTEGER,
  full_size INTEGER,
  -- Every photo in the gallery at once.
  all_photos INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE shares ADD COLUMN price_list_id TEXT REFERENCES price_lists(id) ON DELETE SET NULL;

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  share_id TEXT REFERENCES shares(id) ON DELETE SET NULL,
  -- What it was, kept if the gallery goes.
  gallery_name TEXT NOT NULL,
  share_token TEXT,
  -- The buyer cookie that started it, so the gallery shows their purchases.
  buyer TEXT NOT NULL,
  -- open, paid, needs_review, expired, refunded, disputed
  status TEXT NOT NULL DEFAULT 'open',
  currency TEXT NOT NULL,
  livemode INTEGER,
  amount_subtotal INTEGER NOT NULL,
  amount_total INTEGER,
  amount_tax INTEGER,
  email TEXT,
  name TEXT,
  session_id TEXT,
  payment_intent TEXT,
  -- The order link's key (only its hash).
  link_hash TEXT NOT NULL,
  problem TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX orders_status ON orders (status, created_at);
CREATE INDEX orders_buyer ON orders (share_id, buyer);
CREATE UNIQUE INDEX orders_session ON orders (session_id) WHERE session_id IS NOT NULL;

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  -- small, large, full
  size TEXT NOT NULL,
  unit_amount INTEGER NOT NULL,
  refunded_at TEXT
);
CREATE INDEX order_items_order ON order_items (order_id);

-- Stripe events seen (they come at least once, in any order). Left out of backups.
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  session_id TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO permissions (id, description) VALUES ('payments:setup', 'Connect Stripe and set prices');
INSERT OR IGNORE INTO permissions (id, description) VALUES ('orders:read', 'See orders, with buyers'' names and addresses');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role-admin', 'payments:setup');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES ('role-admin', 'orders:read');
