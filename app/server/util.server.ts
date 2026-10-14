import addressparser from "nodemailer/lib/addressparser";
import MailComposer from "nodemailer/lib/mail-composer";
import type { Address, Unsubscribe } from "~/lib/mail";
import type { OutgoingMessage } from "./providers/types";

/** Runs `fn` on each item, with at most `limit` calls in progress. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function parseAddresses(header: string | undefined): Address[] {
  if (!header) return [];
  const result: Address[] = [];
  const visit = (entries: ReturnType<typeof addressparser>) => {
    for (const entry of entries) {
      if ("group" in entry && entry.group) visit(entry.group);
      else if ("address" in entry && entry.address) {
        result.push({ name: entry.name || undefined, email: entry.address });
      }
    }
  };
  visit(addressparser(header));
  return result;
}

/**
 * Reads the List-Unsubscribe and List-Unsubscribe-Post headers. The first
 * header has a list of addresses in angle brackets, for example
 * `<mailto:leave@example.com?subject=unsubscribe>, <https://example.com/u/123>`.
 */
export function parseListUnsubscribe(
  header: string | undefined,
  postHeader: string | undefined,
): Unsubscribe | undefined {
  if (!header) return undefined;
  let url: string | undefined;
  let mailto: string | undefined;
  for (const [, value] of header.replace(/\s+/g, "").matchAll(/<([^>]+)>/g)) {
    if (!mailto && /^mailto:/i.test(value)) mailto = value;
    // RFC 8058 requires HTTPS for one-click. Ignore plain HTTP.
    else if (!url && /^https:\/\//i.test(value)) url = value;
  }
  if (!url && !mailto) return undefined;
  const oneClick = !!url && /List-Unsubscribe=One-Click/i.test(postHeader ?? "");
  return { url, mailto, oneClick };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(input: string) {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function snippetFromText(text: string | undefined, length = 160) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().slice(0, length);
}

/**
 * Builds an RFC 5322 message. Gmail needs the Bcc header in the raw message,
 * and removes it before delivery. Do not keep Bcc in a message that goes to SMTP.
 */
export async function buildMime(
  from: Address,
  message: OutgoingMessage,
  options: { keepBcc: boolean; messageId?: string },
): Promise<Buffer> {
  const references = [
    ...(message.reply?.references ?? []),
    ...(message.reply?.messageIdHeader ? [message.reply.messageIdHeader] : []),
  ];
  const composer = new MailComposer({
    from: { name: from.name ?? "", address: from.email },
    to: message.to.map(toNodemailer),
    cc: message.cc.map(toNodemailer),
    bcc: message.bcc.map(toNodemailer),
    subject: message.subject,
    messageId: options.messageId,
    text: message.text,
    html: message.html,
    inReplyTo: message.reply?.messageIdHeader,
    references: references.length ? references : undefined,
    attachments: message.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      content: attachment.content,
    })),
  } as ConstructorParameters<typeof MailComposer>[0]);
  // MailComposer ignores a keepBcc option. The compiled message reads it.
  const node = composer.compile();
  node.keepBcc = options.keepBcc;
  return node.build();
}

function toNodemailer(address: Address) {
  return { name: address.name ?? "", address: address.email };
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
