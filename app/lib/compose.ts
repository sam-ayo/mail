import type { AccountSummary, Address, RenderedMessage } from "./mail";
import { formatAddress, formatFullDate } from "./mail";
import { markdownToHtml } from "./markdown";

export interface ReplyContext {
  kind: "reply" | "forward";
  threadId: string;
  messageId: string;
  messageIdHeader?: string;
  references?: string[];
}

export interface ComposeDraft {
  id: string;
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  reply?: ReplyContext;
  /** The quoted original. The app adds it under the body when it sends. */
  quoted?: { html: string; text: string };
}

export function newDraftId() {
  return Math.random().toString(36).slice(2, 10);
}

export function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escapes plain text and turns URLs into links. */
export function textToHtml(text: string) {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br>");
}

/** Returns the inner body of a document that the server rendered. */
export function documentBody(html: string) {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return match ? match[1] : html;
}

/** The body is Markdown. The HTML part shows it formatted, and the text part keeps the Markdown as written. */
export function buildOutgoing(draft: Pick<ComposeDraft, "body" | "quoted">) {
  const bodyHtml = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.5">${markdownToHtml(draft.body)}</div>`;
  return {
    html: draft.quoted ? `${bodyHtml}<br>${draft.quoted.html}` : bodyHtml,
    text: draft.quoted ? `${draft.body}\n\n${draft.quoted.text}` : draft.body,
  };
}

const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function list(addresses: Address[]) {
  return addresses.map(formatAddress).join(", ");
}

function withPrefix(prefix: "Re" | "Fwd", subject: string) {
  const pattern = prefix === "Re" ? /^re:/i : /^(fwd?|fw):/i;
  return pattern.test(subject.trim()) ? subject : `${prefix}: ${subject}`;
}

function quoteText(message: RenderedMessage) {
  return (message.text ?? message.snippet)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function quoteHtmlBody(message: RenderedMessage) {
  return message.html ? documentBody(message.html) : textToHtml(message.text ?? message.snippet);
}

/** Builds a reply, reply-all, or forward draft for a message. */
export function draftFor(
  mode: "reply" | "replyAll" | "forward",
  message: RenderedMessage,
  account: AccountSummary,
): ComposeDraft {
  const reply: ReplyContext = {
    kind: mode === "forward" ? "forward" : "reply",
    threadId: message.threadId,
    messageId: message.id,
    messageIdHeader: message.messageIdHeader,
    references: message.references,
  };

  if (mode === "forward") {
    const header = [
      "---------- Forwarded message ---------",
      `From: ${formatAddress(message.from)}`,
      `Date: ${formatFullDate(message.date)}`,
      `Subject: ${message.subject}`,
      `To: ${list(message.to)}`,
    ];
    return {
      id: newDraftId(),
      accountId: account.id,
      to: "",
      cc: "",
      bcc: "",
      subject: withPrefix("Fwd", message.subject),
      body: "",
      reply,
      quoted: {
        text: `${header.join("\n")}\n\n${message.text ?? message.snippet}`,
        html: `<div class="gmail_quote">${header.map(escapeHtml).join("<br>")}<br><br>${quoteHtmlBody(message)}</div>`,
      },
    };
  }

  const fromMe = sameEmail(message.from.email, account.email);
  const primary = fromMe ? message.to : message.replyTo.length ? message.replyTo : [message.from];
  let cc: Address[] = [];
  if (mode === "replyAll") {
    const seen = new Set(primary.map((a) => a.email.toLowerCase()));
    seen.add(account.email.toLowerCase());
    cc = [...message.to, ...message.cc].filter((address) => {
      const key = address.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const attribution = `On ${formatFullDate(message.date)}, ${formatAddress(message.from)} wrote:`;
  return {
    id: newDraftId(),
    accountId: account.id,
    to: list(primary),
    cc: list(cc),
    bcc: "",
    subject: withPrefix("Re", message.subject),
    body: "",
    reply,
    quoted: {
      text: `${attribution}\n${quoteText(message)}`,
      html: `<div class="gmail_quote"><div>${escapeHtml(attribution)}</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${quoteHtmlBody(message)}</blockquote></div>`,
    },
  };
}
