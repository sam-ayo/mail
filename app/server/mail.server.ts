import type {
  AccountError,
  Folder,
  Message,
  RenderedMessage,
  RenderedThread,
  ThreadAction,
  ThreadSummary,
} from "~/lib/mail";
import { attachmentUrl, unsubscribeMethod } from "~/lib/mail";
import type { Account } from "./accounts.server";
import { getAccount, listAccounts } from "./accounts.server";
import { createDemoProvider } from "./providers/demo.server";
import { createGmailProvider } from "./providers/gmail.server";
import { createImapProvider } from "./providers/imap.server";
import { createOutlookProvider } from "./providers/outlook.server";
import type { MailProvider, OutgoingMessage } from "./providers/types";
import { ProviderAuthError, ProviderError } from "./providers/types";
import { emailDocument, hasQuotedHtml, sanitizeEmailHtml } from "./sanitize.server";
import { errorMessage, parseAddresses } from "./util.server";

export function providerFor(account: Account): MailProvider {
  switch (account.provider) {
    case "google":
      return createGmailProvider(account);
    case "microsoft":
      return createOutlookProvider(account);
    case "imap":
      return createImapProvider(account);
    case "demo":
      return createDemoProvider(account);
  }
}

export async function requireAccount(userId: string, accountId: string) {
  const account = await getAccount(userId, accountId);
  if (!account) throw new ProviderError("Account not found", 404);
  return account;
}

function toAccountError(account: Account, error: unknown): AccountError {
  return {
    accountId: account.id,
    email: account.email,
    message: errorMessage(error),
    reauth: error instanceof ProviderAuthError,
  };
}

// A cursor holds one provider cursor for each account that has more pages.
function encodeCursor(cursors: Record<string, string>) {
  return Object.keys(cursors).length
    ? Buffer.from(JSON.stringify(cursors)).toString("base64url")
    : undefined;
}

function decodeCursor(cursor: string | null): Record<string, string> | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export interface ThreadListResult {
  threads: ThreadSummary[];
  nextCursor?: string;
  errors: AccountError[];
}

/**
 * Lists threads for one account, or for all accounts when `scope` is "all".
 * The unified view asks each account in parallel and merges by date.
 */
export async function listThreads(
  userId: string,
  options: { scope: string; folder: Folder; query?: string; cursor: string | null },
): Promise<ThreadListResult> {
  const all = await listAccounts(userId);
  const accounts = options.scope === "all" ? all : all.filter((a) => a.id === options.scope);
  if (options.scope !== "all" && accounts.length === 0) {
    throw new ProviderError("Account not found", 404);
  }

  const cursors = decodeCursor(options.cursor);
  // On a later page, skip accounts that have no more pages.
  const active = cursors ? accounts.filter((a) => cursors[a.id]) : accounts;
  const limit = accounts.length > 1 ? 20 : 30;

  const results = await Promise.all(
    active.map(async (account) => {
      try {
        const page = await providerFor(account).listThreads({
          folder: options.folder,
          query: options.query || undefined,
          cursor: cursors?.[account.id],
          limit,
        });
        return { account, page };
      } catch (error) {
        return { account, error: toAccountError(account, error) };
      }
    }),
  );

  const threads: ThreadSummary[] = [];
  const nextCursors: Record<string, string> = {};
  const errors: AccountError[] = [];
  for (const result of results) {
    if (result.error) {
      errors.push(result.error);
      continue;
    }
    threads.push(...result.page!.threads);
    if (result.page!.nextCursor) nextCursors[result.account.id] = result.page!.nextCursor;
  }
  threads.sort((a, b) => b.date.localeCompare(a.date));
  return { threads, nextCursor: encodeCursor(nextCursors), errors };
}

function renderMessage(accountId: string, message: Message): RenderedMessage {
  const { html, ...rest } = message;
  if (!html) return { ...rest, hasQuote: false };
  const byContentId = new Map(
    message.attachments
      .filter((a) => a.contentId)
      .map((a) => [a.contentId!, attachmentUrl(accountId, message.id, a.id)]),
  );
  const clean = sanitizeEmailHtml(html, { resolveCid: (cid) => byContentId.get(cid) });
  return {
    ...rest,
    // Inline images show in the body, so do not list them as attachments too.
    attachments: message.attachments.filter(
      (a) => !(a.contentId && html.includes(`cid:${a.contentId}`)),
    ),
    html: emailDocument(clean),
    hasQuote: hasQuotedHtml(clean),
  };
}

export async function loadThread(
  userId: string,
  accountId: string,
  threadId: string,
): Promise<RenderedThread> {
  const account = await requireAccount(userId, accountId);
  const thread = await providerFor(account).getThread(threadId);
  return { ...thread, messages: thread.messages.map((m) => renderMessage(account.id, m)) };
}

export async function modifyThread(
  userId: string,
  accountId: string,
  threadId: string,
  action: ThreadAction,
) {
  const account = await requireAccount(userId, accountId);
  const result = await providerFor(account).modifyThread(threadId, action);
  return { threadId: result?.threadId ?? threadId };
}

export async function sendMessage(userId: string, accountId: string, message: OutgoingMessage) {
  const account = await requireAccount(userId, accountId);
  await providerFor(account).send(message);
}

export async function getAttachment(
  userId: string,
  accountId: string,
  messageId: string,
  attachmentId: string,
) {
  const account = await requireAccount(userId, accountId);
  return providerFor(account).getAttachment(messageId, attachmentId);
}

export type UnsubscribeResult =
  | { method: "oneClick" | "email" }
  /** The sender accepts only a visit to its page. The person must open it. */
  | { method: "website"; url: string };

/**
 * Unsubscribes from the mailing list of one message. The server reads the
 * List-Unsubscribe header again from the provider. Thus the browser cannot make
 * the server send a request or an email to an address of its choice.
 */
export async function unsubscribe(
  userId: string,
  accountId: string,
  threadId: string,
  messageId: string,
): Promise<UnsubscribeResult> {
  const account = await requireAccount(userId, accountId);
  const provider = providerFor(account);
  const thread = await provider.getThread(threadId);
  const target = thread.messages.find((m) => m.id === messageId)?.unsubscribe;
  const method = target && unsubscribeMethod(target);
  if (!target || !method) throw new ProviderError("This message has no unsubscribe option", 404);
  if (method === "website") return { method, url: target.url! };
  // Demo mail has example addresses that do not exist.
  if (account.provider === "demo") return { method };

  if (method === "oneClick") {
    try {
      await postOneClick(target.url!);
      return { method };
    } catch (error) {
      if (!target.mailto) throw error;
    }
  }
  await provider.send(unsubscribeEmail(target.mailto!));
  return { method: "email" };
}

/** Sends the RFC 8058 one-click request. */
async function postOneClick(url: string) {
  const target = new URL(url);
  // Do not send requests to local or internal hosts, or to IP addresses.
  const host = target.hostname.toLowerCase();
  if (
    target.protocol !== "https:" ||
    host === "localhost" ||
    /\.(localhost|local|internal)$/.test(host) ||
    /^[\d.]+$/.test(host) ||
    host.startsWith("[")
  ) {
    throw new ProviderError("The unsubscribe address is not valid", 400);
  }
  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status >= 400) {
    throw new ProviderError(`The sender rejected the request (HTTP ${response.status})`, 502);
  }
}

/** Makes the email for a `mailto:` unsubscribe address, with its subject and body. */
function unsubscribeEmail(mailto: string): OutgoingMessage {
  const [address, query = ""] = mailto.replace(/^mailto:/i, "").split("?");
  const fields = new Map(
    query
      .split("&")
      .filter(Boolean)
      .map((pair) => {
        const [key, value = ""] = pair.split("=");
        return [decodeURIComponent(key).toLowerCase(), decodeURIComponent(value)] as const;
      }),
  );
  const to = parseAddresses(decodeURIComponent(address));
  if (to.length === 0) throw new ProviderError("The unsubscribe address is not valid", 400);
  const text = fields.get("body") || "Unsubscribe";
  const html = `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
  return { to, cc: [], bcc: [], subject: fields.get("subject") || "Unsubscribe", text, html, attachments: [] };
}

/** Inbox unread counts. A slow or failed account gets `null`, not an error. */
export async function unreadCounts(userId: string): Promise<Record<string, number | null>> {
  const accounts = (await listAccounts(userId)).filter((a) => a.status === "active");
  const entries = await Promise.all(
    accounts.map(async (account) => {
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
      const count = providerFor(account)
        .inboxUnreadCount()
        .catch(() => null);
      return [account.id, await Promise.race([count, timeout])] as const;
    }),
  );
  return Object.fromEntries(entries);
}
