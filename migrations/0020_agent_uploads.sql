-- Files that an AI agent uploads to attach to an email (the create_upload MCP
-- tool). The agent sends the bytes to a single-use URL, so the file does not
-- go through the model. Each row expires after one hour, and the server
-- deletes expired rows.
CREATE TABLE agent_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 of the secret in the upload URL. The server does not store the secret.
  token_hash TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  data BYTEA,
  size INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX agent_uploads_expires_at ON agent_uploads (expires_at);
