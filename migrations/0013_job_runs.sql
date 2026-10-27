-- The scheduled jobs. More than one server can run them, for example Vercel and
-- Fly.io during a move, or two Fly.io machines during a deploy. A server runs a
-- job only if it can take the lease of its row. See jobs.server.ts.
CREATE TABLE job_runs (
  name TEXT PRIMARY KEY,
  -- The start of the last run that succeeded.
  ran_at TIMESTAMPTZ,
  -- The current run. The lease ends when the run ends, or at running_until if
  -- the server stops during the run.
  run_id TEXT,
  started_at TIMESTAMPTZ,
  running_until TIMESTAMPTZ
);
