import { requireCronSecret } from "~/server/auth.server";
import { runJob } from "~/server/jobs.server";
import type { Route } from "./+types/api.cron.expire-cache";

// A Vercel cron job calls this route each day. See vercel.json.
// It also deletes the old workspaces of the public demo.
export async function loader({ request }: Route.LoaderArgs) {
  requireCronSecret(request);
  return Response.json(await runJob("expire-cache"));
}
