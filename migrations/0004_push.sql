-- Push notifications. Apply it with: psql "$DATABASE_URL" -f migrations/0004_push.sql
-- One row for each device that turned notifications on. The browser gives the
-- endpoint and the keys. A device that signs in as another user moves to that user.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_id ON push_subscriptions(user_id);
-- The date of the newest inbox thread that the mail check saw for each account.
-- A thread that is newer and unread gets a notification.
CREATE TABLE inbox_checks (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  newest TIMESTAMPTZ NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
