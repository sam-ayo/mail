import { createHmac, timingSafeEqual } from "node:crypto";
import type { Address } from "~/lib/mail";
import { env } from "./env.server";
import type { OutgoingMessage } from "./providers/types";
import { ProviderError } from "./providers/types";

// Resend sends and receives the mail of the hosted addresses.
const API = "https://api.resend.com";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.hosted.resendApiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ProviderError(`Resend: ${body.message ?? `HTTP ${response.status}`}`, 502);
  }
  return body as T;
}

/** A name with a comma or a quote must be in quotes, or Resend reads two addresses. */
const formatAddress = (address: Address) =>
  address.name ? `"${address.name.replace(/["\\]/g, "")}" <${address.email}>` : address.email;

/** Sends the message and returns the Message-ID header that the recipients get. */
export async function sendWithResend(from: Address, message: OutgoingMessage) {
  const references = [
    ...(message.reply?.references ?? []),
    ...(message.reply?.messageIdHeader ? [message.reply.messageIdHeader] : []),
  ];
  const headers: Record<string, string> = {};
  if (message.reply?.messageIdHeader) headers["In-Reply-To"] = message.reply.messageIdHeader;
  if (references.length) headers.References = references.join(" ");

  const { id } = await call<{ id: string }>("/emails", {
    method: "POST",
    body: JSON.stringify({
      from: formatAddress(from),
      to: message.to.map(formatAddress),
      cc: message.cc.map(formatAddress),
      bcc: message.bcc.map(formatAddress),
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers,
      attachments: message.attachments.map((attachment) => ({
        filename: attachment.filename,
        content_type: attachment.contentType,
        content: attachment.content.toString("base64"),
      })),
    }),
  });
  // Amazon SES gives the message its own Message-ID. Replies refer to that ID,
  // so the stored copy must have it too. Resend knows it after a short time.
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    const messageId = await getSentMessageId(id);
    if (messageId) return { id, messageId };
  }
  return { id, messageId: undefined };
}

/** The Message-ID that the recipients got, or undefined if Resend does not know it yet. */
export async function getSentMessageId(id: string) {
  const sent = await call<{ message_id?: string | null }>(`/emails/${encodeURIComponent(id)}`).catch(
    () => undefined,
  );
  return sent?.message_id || undefined;
}

export interface ReceivedEmail {
  id: string;
  to?: string[] | string;
  cc?: string[] | string;
  bcc?: string[] | string;
  received_for?: string[] | string;
  authentication?: Record<string, unknown>;
  raw?: { download_url: string } | null;
}

export function getReceivedEmail(id: string) {
  return call<ReceivedEmail>(`/emails/receiving/${encodeURIComponent(id)}`);
}

/** Downloads the full RFC 5322 message, with its attachments. */
export async function downloadRaw(email: ReceivedEmail) {
  if (!email.raw?.download_url) throw new Error(`Resend has no raw message for ${email.id}`);
  const response = await fetch(email.raw.download_url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`The raw message download failed (HTTP ${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Checks the Svix signature that Resend puts on webhooks. The signed content
 * is "<id>.<timestamp>.<body>", with HMAC-SHA256 and the base64 key after "whsec_".
 */
export function verifyWebhook(headers: Headers, body: string) {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !env.hosted.resendWebhookSecret) return false;
  // Refuse old requests, so a recorded request cannot be sent again later.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;

  const key = Buffer.from(env.hosted.resendWebhookSecret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signatures.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) return false;
    const given = Buffer.from(signature, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
