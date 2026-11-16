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
  /**
   * The ID of the draft on the mail server when the composer opened it. A save
   * can change the ID, so the mail context keeps the current one.
   */
  draftId?: string;
}

/** Only these providers keep drafts on the mail server. */
export function savesDrafts(account: AccountSummary | undefined) {
  return !!account && account.status === "active" && account.provider !== "hosted";
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
export function buildOutgoing(draft: ComposeDraft) {
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

/** The start of the quoted original in the HTML part: the app, Gmail, and Outlook. */
const QUOTE_HTML =
  /<(div|blockquote|hr)[^>]*(class="[^"]*gmail_quote|id="(divRplyFwdMsg|appendonsend|mail-editor-reference-message-container)")/;
/** The start of the quoted original in the text part. */
const QUOTE_TEXT = /\n*(On [^\n]+ wrote:\n+>|-{5,} ?Forwarded message ?-{5,}\n)/;

function htmlToText(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Makes the compose state from a draft on the mail server. The text part is
 * the Markdown body. The quoted original stays apart from the body, as in a
 * new reply, if the draft shows where it starts.
 */
export function draftFromMessage(message: RenderedMessage, accountId: string): ComposeDraft {
  const html = message.html ? documentBody(message.html) : "";
  const quoteAt = html.search(QUOTE_HTML);
  let body: string;
  let quoted: ComposeDraft["quoted"];
  if (message.text === undefined) {
    // A draft from another mail app can have only an HTML part.
    body = html ? htmlToText(quoteAt < 0 ? html : html.slice(0, quoteAt)) : message.snippet;
    if (quoteAt >= 0) quoted = { html: html.slice(quoteAt), text: htmlToText(html.slice(quoteAt)) };
  } else {
    const textAt = quoteAt < 0 ? -1 : message.text.search(QUOTE_TEXT);
    body = textAt < 0 ? message.text : message.text.slice(0, textAt);
    if (textAt >= 0) quoted = { html: html.slice(quoteAt), text: message.text.slice(textAt).replace(/^\n+/, "") };
  }

  // The last reference is the message that the draft answers.
  const references = message.references ?? [];
  const reply: ReplyContext | undefined = references.length
    ? {
        kind: /^(fwd?|fw):/i.test(message.subject.trim()) ? "forward" : "reply",
        threadId: message.threadId,
        messageId: "",
        messageIdHeader: references[references.length - 1],
        references: references.slice(0, -1),
      }
    : undefined;

  return {
    id: newDraftId(),
    accountId,
    to: list(message.to),
    cc: list(message.cc),
    bcc: list(message.bcc),
    subject: message.subject === "(no subject)" ? "" : message.subject,
    body: body.trimEnd(),
    reply,
    quoted,
    draftId: message.draftId,
  };
}
