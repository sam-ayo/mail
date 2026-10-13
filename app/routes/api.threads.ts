import type { ThreadAction } from "~/lib/mail";
import { THREAD_ACTIONS } from "~/lib/mail";
import { requireUserId } from "~/server/auth.server";
import { modifyThread } from "~/server/mail.server";
import { errorMessage, mapLimit } from "~/server/util.server";
import type { Route } from "./+types/api.threads";

interface Body {
  action: ThreadAction;
  targets: { accountId: string; threadId: string }[];
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const body = (await request.json()) as Body;
  if (!THREAD_ACTIONS.includes(body.action) || !Array.isArray(body.targets)) {
    return Response.json({ results: [], errors: [{ message: "Invalid request" }] }, { status: 400 });
  }
  if (body.targets.length > 500) {
    return Response.json({ results: [], errors: [{ message: "Too many conversations" }] }, { status: 400 });
  }

  const results: { accountId: string; threadId: string; newThreadId: string }[] = [];
  const errors: { accountId: string; threadId: string; message: string }[] = [];
  await mapLimit(body.targets, 5, async ({ accountId, threadId }) => {
    try {
      const result = await modifyThread(userId, String(accountId), String(threadId), body.action);
      results.push({ accountId, threadId, newThreadId: result.threadId });
    } catch (error) {
      errors.push({ accountId, threadId, message: errorMessage(error) });
    }
  });

  return Response.json({ results, errors }, { status: errors.length && !results.length ? 502 : 200 });
}
