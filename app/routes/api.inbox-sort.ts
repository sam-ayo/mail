import { requireUserId } from "~/server/auth.server";
import { inboxSortStatus, startInboxSort } from "~/server/triage.server";
import type { Route } from "./+types/api.inbox-sort";

/**
 * The progress of the full inbox sort. The inbox shows it while the sort runs.
 * A sort that stopped, for example in a deploy, starts again here.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  startInboxSort(userId);
  return Response.json(await inboxSortStatus(userId), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
