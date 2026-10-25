-- 0057: invitations by email (plans/PLAN-E-v2.md §4). A one-time link can now set up a team account as well as a
-- client's: team links live 72 hours, client links 14 days. Who queued each email, for the daily caps.
ALTER TABLE client_invites ADD COLUMN kind TEXT NOT NULL DEFAULT 'client';
ALTER TABLE mail_outbox ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX mail_outbox_sender ON mail_outbox (created_by, created_at) WHERE created_by IS NOT NULL;
