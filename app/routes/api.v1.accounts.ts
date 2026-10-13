import { listAccounts, toSummary } from "~/server/accounts.server";
import { requireUserId } from "~/server/auth.server";
import type { Route } from "./+types/api.v1.accounts";

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const accounts = (await listAccounts(userId)).map(toSummary);
  return Response.json({ accounts }, { headers: { "Cache-Control": "private, no-store" } });
}
