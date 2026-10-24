-- The account colors that each person added to the default colors. Apply it with: scripts/migrate.sh
-- All accounts of the workspace can use them.
ALTER TABLE users ADD COLUMN custom_colors TEXT[] NOT NULL DEFAULT '{}';
