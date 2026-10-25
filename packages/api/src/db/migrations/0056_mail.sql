-- 0056: email (plans/PLAN-E-v2.md in cf-dam-docs). Every message is queued here and sent by the WORK queue or the
-- sweep (mail/outbox.ts), never inline. Addresses and one-time links are personal and secret: the table is left out
-- of catalog backups, a sent message's link is cleared, and rows go after 90 days.
CREATE TABLE mail_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  to_address TEXT NOT NULL,
  -- The person it's for, so their mail goes when they do.
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  -- What the template needs (JSON); `link` is removed once the message is sent or has failed for good.
  params TEXT NOT NULL DEFAULT '{}',
  -- queued, sending, sent, failed (for good), dropped (expired, or not on staging's allow list), suppressed
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  -- After this, a queued message isn't worth sending (its link no longer works).
  expires_at TEXT,
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX mail_outbox_waiting ON mail_outbox (next_attempt_at) WHERE status = 'queued';
CREATE INDEX mail_outbox_created ON mail_outbox (created_at);
CREATE INDEX mail_outbox_user ON mail_outbox (user_id) WHERE user_id IS NOT NULL;
