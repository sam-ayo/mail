-- The number of inbox conversations that the current full sort checked. The
-- app shows it while the sort runs. A new full sort starts again at 0.
ALTER TABLE accounts ADD COLUMN inbox_sort_checked INTEGER NOT NULL DEFAULT 0;
