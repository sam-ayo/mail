-- AI sorting moves from a script on the person's computer to the server.
-- The server asks Jev, the model of TypeSafe. It is on by default, and the
-- person can turn it off in Settings.
ALTER TABLE users ADD COLUMN ai_sorting BOOLEAN NOT NULL DEFAULT true;
