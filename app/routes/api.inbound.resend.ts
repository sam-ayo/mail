import { env } from "~/server/env.server";
import { resolvePendingMessageIds, storeMessage } from "~/server/providers/hosted.server";
import { notifyHostedMessage } from "~/server/push.server";
import type { ReceivedEmail } from "~/server/resend.server";
import { downloadRaw, getReceivedEmail, verifyWebhook } from "~/server/resend.server";
import { parseAddresses } from "~/server/util.server";
import type { Route } from "./+types/api.inbound.resend";

// Resend calls this webhook for each email that comes to the hosted domain.
// An error response makes Resend send the webhook again later.
export async function action({ request }: Route.ActionArgs) {
  const body = await request.text();
  if (!verifyWebhook(request.headers, body)) return new Response("Invalid signature", { status: 401 });

  const event = JSON.parse(body) as { type?: string; data?: { email_id?: string } };
  if (event.type !== "email.received" || !event.data?.email_id) return new Response(null, { status: 204 });

  const email = await getReceivedEmail(event.data.email_id);
  const mailboxes = mailboxesFor(email);
  if (mailboxes.length === 0) return new Response(null, { status: 204 });

  const raw = await downloadRaw(email);
  for (const mailbox of mailboxes) {
    await resolvePendingMessageIds(mailbox);
    const folder = failsAuthentication(email) ? "spam" : "inbox";
    const id = await storeMessage({
      mailbox,
      raw,
      folder,
      outgoing: false,
      unread: true,
      // Each mailbox gets its own copy. A repeated webhook adds no copy.
      sourceId: mailboxes.length === 1 ? email.id : `${email.id}:${mailbox}`,
    });
    // A repeated webhook stores nothing, so it sends no second notification.
    // A failed notification must not make Resend send the webhook again.
    if (id && folder === "inbox") {
      await notifyHostedMessage(mailbox, id).catch((error) => console.error("Push failed", error));
    }
  }
  return new Response(null, { status: 204 });
}

/**
 * The hosted addresses that get the message. Mail for an unknown address at a
 * hosted domain goes to the first hosted address at that domain.
 */
function mailboxesFor(email: ReceivedEmail) {
  const recipients = [email.received_for, email.to, email.cc, email.bcc]
    .flat()
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => parseAddresses(value))
    .map((address) => address.email.toLowerCase());
  const { mailboxes } = env.hosted;
  const exact = mailboxes.filter((mailbox) => recipients.includes(mailbox));
  if (exact.length) return exact;
  const domain = (address: string) => address.slice(address.lastIndexOf("@") + 1);
  const domains = new Set(recipients.map(domain));
  const fallback = mailboxes.find((mailbox) => domains.has(domain(mailbox)));
  return fallback ? [fallback] : [];
}

/** A message that fails DMARC claims a sender that did not send it. */
function failsAuthentication(email: ReceivedEmail) {
  const dmarc = email.authentication?.dmarc;
  const result = typeof dmarc === "object" && dmarc ? (dmarc as { result?: unknown }).result : dmarc;
  return typeof result === "string" && result.toLowerCase() === "fail";
}
