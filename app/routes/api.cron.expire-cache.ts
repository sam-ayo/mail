import { requireCronSecret } from "~/server/auth.server";
import { deleteExpiredSummaries } from "~/server/summary-cache.server";
import type { Route } from "./+types/api.cron.expire-cache";

// A Vercel cron job calls this route each day. See vercel.json.
export async function loader({ request }: Route.LoaderArgs) {
  requireCronSecret(request);
  return Response.json({ deleted: await deleteExpiredSummaries() });
}
