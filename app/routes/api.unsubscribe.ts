import { requireUserId } from "~/server/auth.server";
import { unsubscribe } from "~/server/mail.server";
import { ProviderError } from "~/server/providers/types";
import { errorMessage } from "~/server/util.server";
import type { Route } from "./+types/api.unsubscribe";

interface Body {
  accountId: string;
  threadId: string;
  messageId: string;
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const body = (await request.json()) as Body;
  if (!body.accountId || !body.threadId || !body.messageId) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const result = await unsubscribe(
      userId,
      String(body.accountId),
      String(body.threadId),
      String(body.messageId),
    );
    return Response.json(result);
  } catch (error) {
    const status = error instanceof ProviderError && error.status && error.status < 500 ? error.status : 502;
    return Response.json({ error: `Could not unsubscribe: ${errorMessage(error)}` }, { status });
  }
}
