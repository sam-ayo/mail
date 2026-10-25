import { requireUserId } from "~/server/auth.server";
import { releaseNotifications } from "~/server/push.server";
import { setCategories, type CategoryInput } from "~/server/triage.server";
import type { Route } from "./+types/api.categories";

// The person moves conversations between Important and Promotions. The AI
// sorting script reads these changes as examples.

interface Body {
  category: unknown;
  targets: { accountId: string; threadId: string; sender?: string }[];
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || !Array.isArray(body.targets) || body.targets.length > 500) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const items = body.targets.map((t) => ({
    accountId: String(t.accountId),
    threadId: String(t.threadId),
    category: body.category,
    sender: t.sender,
  })) as CategoryInput[];
  const saved = await setCategories(userId, items, "user");
  // A waiting thread that the person moved does not wait for the AI.
  if (saved) {
    await releaseNotifications(userId).catch((error) => console.error("Cannot release the waiting notifications", error));
  }
  return Response.json({ saved }, { status: saved ? 200 : 400 });
}
