import { deleteExpiredDemoUsers } from "~/server/accounts.server";
import { requireCronSecret } from "~/server/auth.server";
import { deleteExpiredSummaries } from "~/server/summary-cache.server";
import type { Route } from "./+types/api.cron.expire-cache";

// A Vercel cron job calls this route each day. See vercel.json.
// It also deletes the old workspaces of the public demo.
export async function loader({ request }: Route.LoaderArgs) {
  requireCronSecret(request);
  return Response.json({
    deleted: await deleteExpiredSummaries(),
    demoWorkspaces: await deleteExpiredDemoUsers(),
  });
}
