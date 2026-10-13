import { requireUserId } from "~/server/auth.server";
import { loadThread } from "~/server/mail.server";
import { ProviderAuthError, ProviderError } from "~/server/providers/types";
import { errorMessage } from "~/server/util.server";
import type { Route } from "./+types/api.v1.thread";

/** One conversation. Each `html` is a full, sanitized document. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  try {
    const thread = await loadThread(userId, params.accountId, params.threadId);
    return Response.json({ thread }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) {
      return Response.json(
        { error: "This conversation no longer exists. Someone may have deleted or moved it." },
        { status: 404 },
      );
    }
    if (error instanceof ProviderAuthError) {
      return Response.json({ error: "This account needs you to sign in again.", reauth: true }, { status: 401 });
    }
    return Response.json({ error: `Could not load the conversation: ${errorMessage(error)}` }, { status: 502 });
  }
}
