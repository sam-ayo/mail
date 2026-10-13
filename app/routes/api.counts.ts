import { requireUserId } from "~/server/auth.server";
import { unreadCounts } from "~/server/mail.server";
import type { Route } from "./+types/api.counts";

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  return Response.json(await unreadCounts(userId), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
