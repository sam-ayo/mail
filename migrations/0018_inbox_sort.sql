-- The full sort of each inbox. When the person opens the app, the server asks
-- Jev about each inbox conversation that has no category, one page at a time.
-- inbox_sort_cursor keeps the next page, so a run that stops continues there.
-- inbox_sorted_at is set when the run gets to the end of the inbox. After that,
-- the mail check sorts new mail. A run takes a lease (inbox_sort_run and
-- inbox_sort_until), so only one server sorts an inbox at a time.
ALTER TABLE accounts ADD COLUMN inbox_sort_cursor TEXT;
ALTER TABLE accounts ADD COLUMN inbox_sorted_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN inbox_sort_run TEXT;
ALTER TABLE accounts ADD COLUMN inbox_sort_until TIMESTAMPTZ;
