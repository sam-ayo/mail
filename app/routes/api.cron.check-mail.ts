import { requireCronSecret } from "~/server/auth.server";
import { checkNewMail } from "~/server/push.server";
import type { Route } from "./+types/api.cron.check-mail";

// The Cloudflare Worker in worker/ calls this route each minute. The Vercel
// Hobby plan runs cron jobs only once a day.
export async function loader({ request }: Route.LoaderArgs) {
  requireCronSecret(request);
  return Response.json(await checkNewMail());
}
