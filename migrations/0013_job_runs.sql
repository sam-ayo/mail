-- The last run of each scheduled job. More than one server can run the jobs,
-- for example Vercel and Fly.io during a move, or two Fly.io machines during a
-- deploy. A server runs a job only if it can claim the row. See jobs.server.ts.
CREATE TABLE job_runs (
  name TEXT PRIMARY KEY,
  ran_at TIMESTAMPTZ NOT NULL
);
