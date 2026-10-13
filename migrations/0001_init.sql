-- Postgres schema for Neon. Apply it with: psql "$DATABASE_URL" -f migrations/0001_init.sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  credentials TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, email)
);
CREATE INDEX accounts_user_id ON accounts(user_id);
