-- Only a sign-in account opens its workspace in a new browser. Before, each
-- account of a workspace opened all the workspace. A person with access to a
-- shared mailbox (for example a team address) then saw all the other mailboxes
-- of the workspace.
ALTER TABLE accounts ADD COLUMN can_sign_in BOOLEAN NOT NULL DEFAULT false;

-- The first account of each workspace is its sign-in account.
UPDATE accounts SET can_sign_in = true
WHERE id IN (
  SELECT DISTINCT ON (user_id) id FROM accounts ORDER BY user_id, created_at, id
);
