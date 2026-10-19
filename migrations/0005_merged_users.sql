-- Workspaces that joined another workspace. Apply it with: scripts/migrate.sh
-- A browser that has the session of a merged workspace uses the workspace that
-- it joined, so no browser loses its accounts.
ALTER TABLE users ADD COLUMN merged_into TEXT REFERENCES users(id);
