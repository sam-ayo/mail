-- The person who signs in to a workspace. A sign-in asks Google or Microsoft
-- only who the person is (openid, email, profile), with no mail access. The
-- person adds mailboxes after the sign-in, so a new workspace has no mailbox.
-- The subject is the Google "sub", or "tid:oid" for Microsoft. A workspace
-- from before this table opens through its sign-in mailbox (accounts.can_sign_in).
CREATE TABLE IF NOT EXISTS sign_ins (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS sign_ins_user_id ON sign_ins (user_id);
