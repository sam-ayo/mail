-- The immutable ID that the provider gives the person: the Google "sub", or
-- "tid:oid" for Microsoft. A Microsoft tenant administrator can set the mail
-- attribute of a user to any address, so an email address does not identify
-- a Microsoft account. Accounts from before this migration have no subject.
-- The next sign-in sets it.
ALTER TABLE accounts ADD COLUMN subject TEXT;
CREATE INDEX accounts_provider_subject ON accounts (provider, subject) WHERE subject IS NOT NULL;

-- A session cookie keeps the version of its workspace. A higher version signs
-- out all the browsers of the workspace. The value 1 signs out all the
-- sessions from before this migration, because those cookies have no version.
-- Some of those sessions opened a workspace through a shared mailbox.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;

-- Counters for the limits on password attempts and on sent mail.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX rate_limits_reset_at ON rate_limits (reset_at);
