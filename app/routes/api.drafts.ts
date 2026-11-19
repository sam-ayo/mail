import type { ReplyContext } from "~/lib/compose";
import { isEmail, parseAddressList } from "~/lib/mail";
import { requireUserId } from "~/server/auth.server";
import { deleteDraft, loadThread, saveDraft } from "~/server/mail.server";
import { ProviderError } from "~/server/providers/types";
import { cleanReplyContext, errorMessage } from "~/server/util.server";
import type { Route } from "./+types/api.drafts";

interface Body {
  accountId?: string;
  draftId?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  html?: string;
  text?: string;
  reply?: ReplyContext;
}

/** A draft can have an address that is not complete. The mail servers reject it, so it stays out. */
const recipients = (field: string | undefined) =>
  parseAddressList(String(field ?? "")).filter((address) => isEmail(address.email));

const status = (error: unknown) => (error instanceof ProviderError && error.status === 404 ? 404 : 502);

/** Reads one draft from the mail server again, so the composer opens with its newest content. */
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const params = new URL(request.url).searchParams;
  const draftId = params.get("draftId");
  try {
    const thread = await loadThread(userId, params.get("accountId") ?? "", params.get("threadId") ?? "");
    const message = thread.messages.find((m) => m.draftId && m.draftId === draftId);
    if (!message) return Response.json({ error: "The draft is not on the mail server." }, { status: 404 });
    return Response.json({ message });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: status(error) });
  }
}

/** POST saves a draft on the mail server. DELETE removes it. */
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const body = (await request.json().catch(() => ({}))) as Body;
  const accountId = String(body.accountId ?? "");
  const draftId = body.draftId ? String(body.draftId) : undefined;

  try {
    if (request.method === "DELETE") {
      if (!draftId) return Response.json({ error: "Invalid request" }, { status: 400 });
      await deleteDraft(userId, accountId, draftId);
      return Response.json({ ok: true });
    }
    const saved = await saveDraft(
      userId,
      accountId,
      {
        to: recipients(body.to),
        cc: recipients(body.cc),
        bcc: recipients(body.bcc),
        subject: String(body.subject ?? ""),
        html: String(body.html ?? ""),
        text: String(body.text ?? ""),
        reply: cleanReplyContext(body.reply),
        attachments: [],
      },
      draftId,
    );
    return Response.json(saved);
  } catch (error) {
    return Response.json({ error: `The draft did not save: ${errorMessage(error)}` }, { status: status(error) });
  }
}
