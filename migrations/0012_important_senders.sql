-- Senders whose mail always goes to Important. The list has priority over AI
-- sorting, and applies to all accounts of the person. A pattern is a full
-- address (jobs@indeed.com) or a domain (@mun.ca), in lowercase. A domain also
-- matches its subdomains.
CREATE TABLE important_senders (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pattern)
);
