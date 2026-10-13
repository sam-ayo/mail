import type { ReplyContext } from "~/lib/compose";
import { parseAddressList } from "~/lib/mail";
import { requireUserId } from "~/server/auth.server";
import { sendMessage } from "~/server/mail.server";
import { errorMessage } from "~/server/util.server";
import type { Route } from "./+types/api.send";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const text = (name: string) => String(form.get(name) ?? "");

  const to = parseAddressList(text("to"));
  const cc = parseAddressList(text("cc"));
  const bcc = parseAddressList(text("bcc"));
  if (to.length + cc.length + bcc.length === 0) {
    return Response.json({ error: "Add at least one recipient." }, { status: 400 });
  }

  const files = form.getAll("attachments").filter((value): value is File => value instanceof File);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_ATTACHMENT_BYTES) {
    return Response.json({ error: "Attachments must be 25 MB or less in total." }, { status: 400 });
  }

  let reply: ReplyContext | undefined;
  if (form.get("reply")) {
    try {
      reply = JSON.parse(text("reply"));
    } catch {
      return Response.json({ error: "Invalid reply data." }, { status: 400 });
    }
  }

  try {
    await sendMessage(userId, text("accountId"), {
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
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: `The message did not send: ${errorMessage(error)}` }, { status: 502 });
  }
}
