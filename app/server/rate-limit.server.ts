import { query, queryOne } from "./db.server";

/**
 * Counts one attempt for the key. Returns false when the key has more than
 * `limit` attempts in the window. The counters are in the database, because
 * two app containers serve the requests.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const row = await queryOne<{ count: number }>(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
     RETURNING count`,
    [key, windowSeconds],
  );
  return (row?.count ?? 0) <= limit;
}

/** Deletes the counters whose window ended. The cache cron job calls it. */
export async function deleteExpiredRateLimits() {
  await query("DELETE FROM rate_limits WHERE reset_at <= now()");
}

export function tooManyRequests(message = "Too many attempts. Try again later.") {
  return new Response(message, { status: 429, headers: { "Retry-After": "900" } });
}
