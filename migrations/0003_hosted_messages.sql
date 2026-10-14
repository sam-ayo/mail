-- Mail for the addresses that Relay hosts. Apply it with: psql "$DATABASE_URL" -f migrations/0003_hosted_messages.sql
-- The rows belong to the mailbox address, not to an account. Thus mail that
-- comes before the person connects the address, or after they remove it, stays.
-- "folder" is inbox, sent, archive, spam or trash. "outgoing" is true for mail
-- that the mailbox sent, so a thread action can put it back in Sent.
CREATE TABLE hosted_messages (
  id TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  outgoing BOOLEAN NOT NULL DEFAULT false,
  unread BOOLEAN NOT NULL DEFAULT true,
  starred BOOLEAN NOT NULL DEFAULT false,
  date TIMESTAMPTZ NOT NULL,
  message_id TEXT,
  subject TEXT NOT NULL DEFAULT '',
  from_address JSONB NOT NULL,
  to_addresses JSONB NOT NULL DEFAULT '[]',
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  has_attachments BOOLEAN NOT NULL DEFAULT false,
  raw BYTEA NOT NULL,
  -- The ID that the delivery service gave the message. A repeated webhook does not add a copy.
  source_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hosted_messages_folder ON hosted_messages(mailbox, folder, date DESC);
CREATE INDEX hosted_messages_thread ON hosted_messages(mailbox, thread_id);
CREATE INDEX hosted_messages_message_id ON hosted_messages(mailbox, message_id);
