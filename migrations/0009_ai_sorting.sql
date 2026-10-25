-- AI sorting of the inbox. Apply it with: scripts/migrate.sh
-- A script on the user's computer sorts new inbox conversations with Claude Code
-- or Codex, and sends the results to /api/triage with a personal API token.

-- The category of each sorted conversation. "source" is "ai", or "user" when the
-- person moved the conversation. The script reads "user" rows as examples.
CREATE TABLE thread_categories (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('important', 'promotion')),
  source TEXT NOT NULL CHECK (source IN ('ai', 'user')),
  sender TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, thread_id)
);
CREATE INDEX thread_categories_user_examples ON thread_categories(account_id, updated_at) WHERE source = 'user';

-- Personal API tokens. Only the SHA-256 hash of a token stays in the database.
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX api_tokens_user_id ON api_tokens(user_id);
