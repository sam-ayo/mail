import { env } from "~/server/env.server";
import { resolvePendingMessageIds, storeMessage } from "~/server/providers/hosted.server";
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
  const mailbox = mailboxFor(email);
  if (!mailbox) return new Response(null, { status: 204 });

  await resolvePendingMessageIds(mailbox);
  await storeMessage({
    mailbox,
    raw: await downloadRaw(email),
    folder: failsAuthentication(email) ? "spam" : "inbox",
    outgoing: false,
    unread: true,
    sourceId: email.id,
  });
  return new Response(null, { status: 204 });
}

/**
 * The hosted address that gets the message. Mail for an unknown address at a
 * hosted domain goes to the first hosted address.
 */
function mailboxFor(email: ReceivedEmail) {
  const recipients = [email.received_for, email.to, email.cc, email.bcc]
    .flat()
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => parseAddresses(value))
    .map((address) => address.email.toLowerCase());
  const { mailboxes } = env.hosted;
  const exact = mailboxes.find((mailbox) => recipients.includes(mailbox));
  if (exact) return exact;
  const domain = (address: string) => address.slice(address.lastIndexOf("@") + 1);
  const domains = new Set(recipients.map(domain));
  return mailboxes.find((mailbox) => domains.has(domain(mailbox)));
}

/** A message that fails DMARC claims a sender that did not send it. */
function failsAuthentication(email: ReceivedEmail) {
  const dmarc = email.authentication?.dmarc;
  const result = typeof dmarc === "object" && dmarc ? (dmarc as { result?: unknown }).result : dmarc;
  return typeof result === "string" && result.toLowerCase() === "fail";
}
