import type { ReplyContext } from "~/lib/compose";
import { isEmail, parseAddressList } from "~/lib/mail";
import { requireUserId } from "~/server/auth.server";
import { sendMessage } from "~/server/mail.server";
import { rateLimit } from "~/server/rate-limit.server";
import { cleanReplyContext, errorMessage } from "~/server/util.server";
import type { Route } from "./+types/api.send";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** The attachments, the body and the form encoding. A larger request stops before the server reads it. */
const MAX_REQUEST_BYTES = 30 * 1024 * 1024;
/** The most messages that a workspace can send in one hour. It limits the damage of a stolen session. */
const SENDS_PER_HOUR = 100;

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Attachments must be 25 MB or less in total." }, { status: 413 });
  }
  if (!(await rateLimit(`send:${userId}`, SENDS_PER_HOUR, 60 * 60))) {
    return Response.json({ error: "You sent too many messages in the last hour. Try again later." }, { status: 429 });
  }
  const form = await request.formData();
  const text = (name: string) => String(form.get(name) ?? "");

  const to = parseAddressList(text("to"));
  const cc = parseAddressList(text("cc"));
  const bcc = parseAddressList(text("bcc"));
  if (to.length + cc.length + bcc.length === 0) {
    return Response.json({ error: "Add at least one recipient." }, { status: 400 });
  }

  const invalid = [...to, ...cc, ...bcc].find((address) => !isEmail(address.email));
  if (invalid) {
    return Response.json({ error: `“${invalid.email}” is not a valid email address.` }, { status: 400 });
  }

  const files = form.getAll("attachments").filter((value): value is File => value instanceof File);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_ATTACHMENT_BYTES) {
    return Response.json({ error: "Attachments must be 25 MB or less in total." }, { status: 400 });
  }

  let reply: ReplyContext | undefined;
  if (form.get("reply")) {
    try {
      reply = cleanReplyContext(JSON.parse(text("reply")));
    } catch {
      return Response.json({ error: "Invalid reply data." }, { status: 400 });
    }
  }

  try {
    await sendMessage(
      userId,
      text("accountId"),
      {
        to,
        cc,
        bcc,
        subject: text("subject"),
        html: text("html"),
        text: text("text"),
        reply,
        attachments: await Promise.all(
          files.map(async (file) => ({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            content: Buffer.from(await file.arrayBuffer()),
          })),
        ),
      },
      text("draftId") || undefined,
    );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: `The message did not send: ${errorMessage(error)}` }, { status: 502 });
  }
}
