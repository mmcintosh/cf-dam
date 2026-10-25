-- 0055: a link to the client's or job's record in the photographer's CRM (HoneyBook, Studio Ninja, Dubsado…): cf-dam
-- keeps no contracts or invoices of its own (research/REVIEW-overall-v1.md §4). Empty: none.
ALTER TABLE jobs ADD COLUMN crm_url TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN crm_url TEXT NOT NULL DEFAULT '';
