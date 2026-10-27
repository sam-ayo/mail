import { deleteExpiredDemoUsers } from "./accounts.server";
import { query } from "./db.server";
import { checkNewMail } from "./push.server";
import { deleteExpiredSummaries } from "./summary-cache.server";

const jobs = {
  /** Sends push notifications for new mail in Gmail, Outlook, and IMAP accounts. */
  "check-mail": { seconds: 60, run: checkNewMail },
  /** Deletes old thread summaries and the old workspaces of the public demo. */
  "expire-cache": {
    seconds: 24 * 60 * 60,
    run: async () => ({ deleted: await deleteExpiredSummaries(), demoWorkspaces: await deleteExpiredDemoUsers() }),
  },
};

export type JobName = keyof typeof jobs;

/**
 * Claims a job for its period. It is false when another server ran the job in
 * this period. The 10 seconds let a run that starts a little early still count.
 */
async function claim(name: JobName) {
  try {
    const rows = await query(
      `INSERT INTO job_runs (name, ran_at) VALUES ($1, now())
       ON CONFLICT (name) DO UPDATE SET ran_at = now()
       WHERE job_runs.ran_at < now() - make_interval(secs => $2)
       RETURNING 1`,
      [name, jobs[name].seconds - 10],
    );
    return rows.length > 0;
  } catch (error) {
    // Until migrations/0013_job_runs.sql runs, the table does not exist. Then run the job, as before.
    if ((error as { code?: string }).code === "42P01") return true;
    throw error;
  }
}

/** Runs a job if no other server ran it in its period. */
export async function runJob(name: JobName) {
  if (!(await claim(name))) return { skipped: true };
  return jobs[name].run();
}

const running = new Set<JobName>();

/**
 * Runs the jobs each minute in this process. A server that runs all the time,
 * such as on Fly.io, uses this. On Vercel, a Cloudflare Worker and Vercel cron
 * call the /api/cron routes. RUN_JOBS=1 turns it on.
 */
export function startJobs() {
  const tick = () => {
    for (const name of Object.keys(jobs) as JobName[]) {
      // A slow mail check must not overlap with the next one.
      if (running.has(name)) continue;
      running.add(name);
      runJob(name)
        .catch((error) => console.error(`Job ${name} failed`, error))
        .finally(() => running.delete(name));
    }
  };
  setInterval(tick, 60_000);
  tick();
}
