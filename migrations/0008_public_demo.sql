-- The public demo gives each visitor a workspace with the same sample addresses,
-- such as alex@northwind.io. Thus an address is unique only for real mailboxes.
ALTER TABLE accounts DROP CONSTRAINT accounts_provider_email_key;
CREATE UNIQUE INDEX accounts_provider_email_key ON accounts (provider, email) WHERE provider <> 'demo';

-- A demo workspace. The daily cron job deletes it after a week.
ALTER TABLE users ADD COLUMN demo BOOLEAN NOT NULL DEFAULT false;
