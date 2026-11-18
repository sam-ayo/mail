-- A shared mailbox, for example a team address, can be in the workspace of
-- each person who uses it. Each workspace has its own account and credentials.
-- An address is unique only in a workspace.
DROP INDEX accounts_provider_email_key;
CREATE UNIQUE INDEX accounts_user_provider_email_key ON accounts (user_id, provider, email) WHERE provider <> 'demo';
CREATE INDEX accounts_provider_email ON accounts (provider, email);
