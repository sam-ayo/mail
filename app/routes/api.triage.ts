import { requireApiTokenUser } from "~/server/api-tokens.server";
import { releaseNotifications } from "~/server/push.server";
import { setCategories, unsortedThreads, type CategoryInput } from "~/server/triage.server";
import type { Route } from "./+types/api.triage";

// The API of the AI sorting script (scripts/ai-sorting). The script sends a
// personal API token from Settings.

const MAX_LIMIT = 50;

/** GET: the newest inbox conversations that have no category, and the person's examples. */
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireApiTokenUser(request);
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? 25);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 25));
  return Response.json(await unsortedThreads(userId, limit));
}

/** POST: { results: [{ account_id, thread_id, category, sender? }] } from the AI. */
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireApiTokenUser(request);
  const body = (await request.json().catch(() => null)) as {
    results?: { account_id?: unknown; thread_id?: unknown; category?: unknown; sender?: unknown }[];
  } | null;
  if (!body || !Array.isArray(body.results) || body.results.length > 200) {
    return Response.json({ error: "Send { results: [...] } with at most 200 items" }, { status: 400 });
  }
  const items = body.results.map((r) => ({
    accountId: String(r.account_id ?? ""),
    threadId: String(r.thread_id ?? ""),
    category: r.category,
    sender: typeof r.sender === "string" ? r.sender : undefined,
  })) as CategoryInput[];
  const saved = await setCategories(userId, items, "ai");
  // New threads that waited for the AI get their notification now, if they are important.
  await releaseNotifications(userId).catch((error) => console.error("Cannot release the waiting notifications", error));
  return Response.json({ saved });
}
