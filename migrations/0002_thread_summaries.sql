-- Cached Gmail thread summaries. Apply it with: psql "$DATABASE_URL" -f migrations/0002_thread_summaries.sql
-- A row stays valid while the thread's history_id stays the same. "people" is
-- "from" or "to", because Sent and Drafts show the recipients.
CREATE TABLE thread_summaries (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  people TEXT NOT NULL,
  history_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, thread_id, people)
);
CREATE INDEX thread_summaries_updated_at ON thread_summaries(updated_at);
