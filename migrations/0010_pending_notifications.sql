-- Notifications that wait for the AI sorting. Apply it with: scripts/migrate.sh
-- When the AI sorting script runs, a new thread with no category waits here.
-- The server sends its notification when the AI sorts it as important, and
-- drops it when the AI sorts it as a promotion. After some minutes with no
-- category, the notification goes anyway.
CREATE TABLE pending_notifications (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  -- The ThreadSummary for the text of the notification.
  thread JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, thread_id)
);
CREATE INDEX pending_notifications_created_at ON pending_notifications(created_at);
