import { deleteExpiredDemoUsers } from "./accounts.server";
import { randomToken } from "./crypto.server";
import { query } from "./db.server";
import { checkNewMail } from "./push.server";
import { deleteExpiredSummaries } from "./summary-cache.server";

const jobs = {
  /** Sends push notifications for new mail in Gmail, Outlook, and IMAP accounts. */
  "check-mail": { seconds: 60, maxSeconds: 10 * 60, run: checkNewMail },
  /** Deletes old thread summaries and the old workspaces of the public demo. */
  "expire-cache": {
    seconds: 24 * 60 * 60,
    maxSeconds: 30 * 60,
    run: async () => ({ deleted: await deleteExpiredSummaries(), demoWorkspaces: await deleteExpiredDemoUsers() }),
  },
};

export type JobName = keyof typeof jobs;

/**
 * Takes the lease of a job. It returns null when the job ran in this period or
 * runs now on another server. The 10 seconds let a run that starts a little
 * early still count. If the server stops during the run, the lease ends after
 * maxSeconds.
 */
async function claim(name: JobName): Promise<string | null> {
  const runId = randomToken(12);
  try {
    const rows = await query(
      `INSERT INTO job_runs (name, run_id, started_at, running_until)
       VALUES ($1, $2, now(), now() + make_interval(secs => $4))
       ON CONFLICT (name) DO UPDATE
       SET run_id = $2, started_at = now(), running_until = now() + make_interval(secs => $4)
       WHERE (job_runs.ran_at IS NULL OR job_runs.ran_at < now() - make_interval(secs => $3))
         AND (job_runs.running_until IS NULL OR job_runs.running_until < now())
       RETURNING 1`,
      [name, runId, jobs[name].seconds - 10, jobs[name].maxSeconds],
    );
    return rows.length > 0 ? runId : null;
  } catch (error) {
    // Until migrations/0013_job_runs.sql runs, the table does not exist. Then run the job, as before.
    if ((error as { code?: string }).code === "42P01") return "";
    throw error;
  }
}

/**
 * Ends the lease. Only a run that succeeded counts as the run of the period,
 * so a failed run tries again in the next minute.
 */
async function release(name: JobName, runId: string, succeeded: boolean) {
  if (!runId) return;
  await query(
    `UPDATE job_runs SET running_until = NULL ${succeeded ? ", ran_at = started_at" : ""}
     WHERE name = $1 AND run_id = $2`,
    [name, runId],
  );
}

/** Runs a job if no other server ran it in its period or runs it now. */
export async function runJob(name: JobName) {
  const runId = await claim(name);
  if (runId === null) return { skipped: true };
  let result;
  try {
    result = await jobs[name].run();
  } catch (error) {
    await release(name, runId, false).catch((releaseError) => console.error(`Cannot release job ${name}`, releaseError));
    throw error;
  }
  await release(name, runId, true);
  return result;
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
