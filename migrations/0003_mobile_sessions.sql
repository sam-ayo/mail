-- Sign-in tokens for the iOS app. Apply it with: psql "$DATABASE_URL" -f migrations/0003_mobile_sessions.sql
-- The table keeps only a SHA-256 hash of each token.
CREATE TABLE mobile_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mobile_sessions_user_id ON mobile_sessions(user_id);
