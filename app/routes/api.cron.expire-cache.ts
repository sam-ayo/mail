import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "~/server/env.server";
import { deleteExpiredSummaries } from "~/server/summary-cache.server";
import type { Route } from "./+types/api.cron.expire-cache";

// A Vercel cron job calls this route each day. See vercel.json.
export async function loader({ request }: Route.LoaderArgs) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const given = request.headers.get("authorization") ?? "";
  if (!env.cronSecret || !timingSafeEqual(digest(given), digest(`Bearer ${env.cronSecret}`))) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({ deleted: await deleteExpiredSummaries() });
}
