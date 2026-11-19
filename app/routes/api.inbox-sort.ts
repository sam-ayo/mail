import { requireUserId } from "~/server/auth.server";
import { inboxSortStatus } from "~/server/triage.server";
import type { Route } from "./+types/api.inbox-sort";

/** The progress of the full inbox sort. The inbox shows it while the sort runs. */
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  return Response.json(await inboxSortStatus(userId), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
