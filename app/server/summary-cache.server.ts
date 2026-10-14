import type { ThreadSummary } from "~/lib/mail";
import { decrypt, encrypt } from "./crypto.server";
import { query } from "./db.server";

// Thread summaries in Postgres, so that a new server instance does not ask
// the provider again for each row. The summaries contain mail subjects and
// snippets, so they are encrypted. A cache error never stops a list load.

export type SummaryPeople = "from" | "to";

// The privacy policy promises this limit. Reads ignore older rows, and a daily
// cron job deletes them.
const MAX_AGE_DAYS = 60;

export async function loadSummaries(
  accountId: string,
  people: SummaryPeople,
  threads: { id: string; historyId: string }[],
): Promise<Map<string, ThreadSummary>> {
  const found = new Map<string, ThreadSummary>();
  if (threads.length === 0) return found;
  try {
    const rows = await query<{ thread_id: string; history_id: string; summary: string }>(
      `SELECT thread_id, history_id, summary FROM thread_summaries
       WHERE account_id = $1 AND people = $2 AND thread_id = ANY($3)
         AND updated_at >= now() - make_interval(days => $4)`,
      [accountId, people, threads.map((t) => t.id), MAX_AGE_DAYS],
    );
    const historyIds = new Map(threads.map((t) => [t.id, t.historyId]));
    for (const row of rows) {
      if (historyIds.get(row.thread_id) !== row.history_id) continue;
      found.set(row.thread_id, JSON.parse(decrypt(row.summary)) as ThreadSummary);
    }
  } catch (error) {
    console.error("Thread summary cache read failed", error);
  }
  return found;
}

export async function saveSummaries(
  accountId: string,
  people: SummaryPeople,
  entries: { historyId: string; summary: ThreadSummary }[],
) {
  if (entries.length === 0) return;
  try {
    await query(
      `INSERT INTO thread_summaries (account_id, thread_id, people, history_id, summary)
       SELECT $1, t.thread_id, $2, t.history_id, t.summary
       FROM unnest($3::text[], $4::text[], $5::text[]) AS t(thread_id, history_id, summary)
       ON CONFLICT (account_id, thread_id, people) DO UPDATE
       SET history_id = excluded.history_id, summary = excluded.summary, updated_at = now()`,
      [
        accountId,
        people,
        entries.map((e) => e.summary.id),
        entries.map((e) => e.historyId),
        entries.map((e) => encrypt(JSON.stringify(e.summary))),
      ],
    );
  } catch (error) {
    console.error("Thread summary cache write failed", error);
  }
}

/** Deletes the summaries that are older than the maximum age. A daily cron job calls it. */
export async function deleteExpiredSummaries() {
  const rows = await query<{ count: number }>(
    `WITH deleted AS (
       DELETE FROM thread_summaries WHERE updated_at < now() - make_interval(days => $1) RETURNING 1
     )
     SELECT COUNT(*)::int AS count FROM deleted`,
    [MAX_AGE_DAYS],
  );
  return rows[0]?.count ?? 0;
}
