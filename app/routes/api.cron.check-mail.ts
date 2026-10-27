import { requireCronSecret } from "~/server/auth.server";
import { runJob } from "~/server/jobs.server";
import type { Route } from "./+types/api.cron.check-mail";

// The Cloudflare Worker in worker/ calls this route each minute. The Vercel
// Hobby plan runs cron jobs only once a day. A server with RUN_JOBS=1 runs the
// job itself, and runJob makes sure that only one of them runs it each minute.
export async function loader({ request }: Route.LoaderArgs) {
  requireCronSecret(request);
  return Response.json(await runJob("check-mail"));
}
