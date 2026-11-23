import { waitUntil } from "@vercel/functions";
import type {
  Address,
  Attachment,
  MailboxFolder,
  Message,
  Thread,
  ThreadAction,
  ThreadSummary,
} from "~/lib/mail";
import type { Account } from "../accounts.server";
import { setAccountStatus } from "../accounts.server";
import { composioProxy, isComposioCredentials } from "../oauth/composio.server";
import { createTokenSource } from "../oauth/tokens.server";
import { loadSummaries, saveSummaries } from "../summary-cache.server";
import { buildMime, decodeEntities, mapLimit, parseAddresses, parseListUnsubscribe } from "../util.server";
import type { ListOptions, MailProvider, OutgoingMessage, ThreadPage } from "./types";
import { ProviderAuthError, ProviderError } from "./types";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: GmailHeader[];
  body: { size: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  internalDate: string;
  payload: GmailPart;
}

interface GmailThread {
  id: string;
  historyId: string;
  messages: GmailMessage[];
}

const FOLDER_QUERY: Record<MailboxFolder, { labelIds?: string[]; q?: string }> = {
  inbox: { labelIds: ["INBOX"] },
  starred: { labelIds: ["STARRED"] },
  sent: { labelIds: ["SENT"] },
  drafts: { labelIds: ["DRAFT"] },
  archive: { q: "-in:inbox -in:spam -in:trash -in:draft" },
  spam: { labelIds: ["SPAM"] },
  trash: { labelIds: ["TRASH"] },
};

// Thread metadata does not change while the thread's historyId stays the same.
// This cache turns a repeat list request into one API call.
const summaryCache = new Map<string, ThreadSummary>();
const SUMMARY_CACHE_LIMIT = 5000;

function cacheSummary(key: string, summary: ThreadSummary) {
  if (summaryCache.size >= SUMMARY_CACHE_LIMIT) {
    const oldest = summaryCache.keys().next().value;
    if (oldest) summaryCache.delete(oldest);
  }
  summaryCache.set(key, summary);
}

function header(headers: GmailHeader[] | undefined, name: string) {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value;
}

function decodeBody(data: string, contentType?: string) {
  const charset = contentType?.match(/charset="?([^";]+)"?/i)?.[1] ?? "utf-8";
  const bytes = Buffer.from(data, "base64url");
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function walkParts(part: GmailPart, visit: (part: GmailPart) => void) {
  visit(part);
  part.parts?.forEach((child) => walkParts(child, visit));
}

function uniqueAddresses(addresses: Address[]) {
  const seen = new Set<string>();
  return addresses.filter((address) => {
    const key = address.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The Gmail quota units of a request. Gmail lets each person use 6,000 units
 * each minute in the app's Google project. A request that is not in the list costs 10.
 */
function quotaUnits(path: string, method = "GET") {
  if (path.startsWith("/messages/send")) return 100;
  if (path.startsWith("/labels")) return 1;
  if (method === "GET" && (path.startsWith("/messages") || path.startsWith("/drafts?"))) return 5;
  return 10;
}

/**
 * Sends Gmail requests at a steady rate of quota units. Gmail also refuses short
 * bursts, so the requests of a long task, such as the full inbox sort, go through a pace.
 */
export class GmailPace {
  private tokens = 0;
  private at = Date.now();
  private queue = Promise.resolve();

  constructor(
    public unitsPerMinute: number,
    private readonly minUnits: number,
    private readonly maxUnits: number,
  ) {}

  /** Waits until the request can use its units. */
  take(units: number) {
    const turn = this.queue.then(async () => {
      const rate = this.unitsPerMinute / 60_000;
      const now = Date.now();
      // At most one second of unused units stays available.
      this.tokens = Math.min(this.tokens + (now - this.at) * rate, Math.max(units, rate * 1000));
      this.at = now;
      if (this.tokens < units) {
        await new Promise((resolve) => setTimeout(resolve, (units - this.tokens) / rate));
        this.tokens = units;
        this.at = Date.now();
      }
      this.tokens -= units;
    });
    this.queue = turn;
    return turn;
  }

  /** Gmail refused a request. The rate goes down to half. */
  slower() {
    this.unitsPerMinute = Math.max(this.minUnits, this.unitsPerMinute / 2);
  }

  /** Gmail accepted the requests. The rate goes up a little. */
  faster() {
    this.unitsPerMinute = Math.min(this.maxUnits, this.unitsPerMinute * 1.1);
  }
}

export function createGmailProvider(account: Account, pace?: GmailPace): MailProvider {
  const composio = isComposioCredentials(account.credentials) ? account.credentials : undefined;
  const tokens = composio ? undefined : createTokenSource(account);

  /** Sends the request through Composio, which adds the Google token. */
  async function composioFetch(path: string, init: RequestInit): Promise<Response> {
    try {
      const result = await composioProxy(composio!, `${API}${path}`, {
        method: init.method,
        body: typeof init.body === "string" ? init.body : undefined,
      });
      const headers = new Headers(result.headers);
      headers.set("Content-Type", "application/json");
      const body = result.status === 204 || result.data == null ? null : JSON.stringify(result.data);
      return new Response(body, { status: result.status, headers });
    } catch (error) {
      if (error instanceof ProviderAuthError) await setAccountStatus(account.id, "reauth_required");
      throw error;
    }
  }

  async function request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    await pace?.take(quotaUnits(path, init.method));
    if (composio) {
      const response = await composioFetch(path, init);
      return handle<T>(response, path, init, attempt);
    }
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await tokens!.get()}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (response.status === 401 && attempt === 0) {
      await tokens!.refresh();
      return request(path, init, attempt + 1);
    }
    return handle<T>(response, path, init, attempt);
  }

  async function handle<T>(response: Response, path: string, init: RequestInit, attempt: number): Promise<T> {
    if (response.status === 401) {
      await setAccountStatus(account.id, "reauth_required");
      throw new ProviderAuthError();
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      // Gmail counts quota per user per minute, so a 429 needs a longer pause.
      const retryAfter = Number(response.headers.get("Retry-After")) * 1000;
      const delay = response.status === 429 ? Math.min(retryAfter || 2 ** attempt * 2000, 8000) : 2 ** attempt * 500;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return request(path, init, attempt + 1);
    }
    if (response.status === 429) {
      throw new ProviderError("Gmail limits how many requests the app can send each minute. Try again in a minute.", 429);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new ProviderError(body.error?.message ?? `Gmail error ${response.status}`, response.status);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  function summarize(thread: GmailThread, folder: MailboxFolder): ThreadSummary {
    const messages = thread.messages;
    const first = messages[0];
    const last = messages[messages.length - 1];
    const people =
      folder === "sent" || folder === "drafts"
        ? messages.flatMap((m) => parseAddresses(header(m.payload.headers, "To")))
        : messages.flatMap((m) => parseAddresses(header(m.payload.headers, "From")));
    return {
      accountId: account.id,
      id: thread.id,
      subject: header(first.payload.headers, "Subject") || "(no subject)",
      snippet: decodeEntities(last.snippet ?? ""),
      participants: uniqueAddresses(people),
      date: new Date(Number(last.internalDate)).toISOString(),
      unread: messages.some((m) => m.labelIds?.includes("UNREAD")),
      starred: messages.some((m) => m.labelIds?.includes("STARRED")),
      messageCount: messages.length,
      hasAttachments: messages.some((m) => m.payload.mimeType === "multipart/mixed"),
      messageIds: messages
        .map((m) => header(m.payload.headers, "Message-ID"))
        .filter((id): id is string => !!id),
    };
  }

  function toMessage(message: GmailMessage): Message {
    const headers = message.payload.headers;
    let html: string | undefined;
    let text: string | undefined;
    const attachments: Attachment[] = [];

    walkParts(message.payload, (part) => {
      const contentType = header(part.headers, "Content-Type");
      const disposition = header(part.headers, "Content-Disposition") ?? "";
      const contentId = header(part.headers, "Content-ID")?.replace(/^<|>$/g, "");
      const isFile = !!part.filename || !!part.body.attachmentId;
      if (isFile && part.partId) {
        attachments.push({
          id: part.partId,
          filename: part.filename || "attachment",
          mimeType: part.mimeType,
          size: part.body.size,
          contentId,
          inline: disposition.startsWith("inline") || (!!contentId && !part.filename),
        });
        return;
      }
      if (part.mimeType === "text/html" && part.body.data && html === undefined) {
        html = decodeBody(part.body.data, contentType);
      } else if (part.mimeType === "text/plain" && part.body.data && text === undefined) {
        text = decodeBody(part.body.data, contentType);
      }
    });

    const references = header(headers, "References")?.split(/\s+/).filter(Boolean);
    return {
      id: message.id,
      threadId: message.threadId,
      from: parseAddresses(header(headers, "From"))[0] ?? { email: "unknown" },
      to: parseAddresses(header(headers, "To")),
      cc: parseAddresses(header(headers, "Cc")),
      bcc: parseAddresses(header(headers, "Bcc")),
      replyTo: parseAddresses(header(headers, "Reply-To")),
      subject: header(headers, "Subject") || "(no subject)",
      date: new Date(Number(message.internalDate)).toISOString(),
      snippet: decodeEntities(message.snippet ?? ""),
      html,
      text,
      unread: !!message.labelIds?.includes("UNREAD"),
      starred: !!message.labelIds?.includes("STARRED"),
      attachments,
      messageIdHeader: header(headers, "Message-ID") ?? header(headers, "Message-Id"),
      references,
      unsubscribe: parseListUnsubscribe(
        header(headers, "List-Unsubscribe"),
        header(headers, "List-Unsubscribe-Post"),
      ),
    };
  }

  /** The request body of a draft. A reply draft stays in the conversation of the original. */
  async function draftBody(message: OutgoingMessage) {
    const raw = await buildMime({ name: account.name, email: account.email }, message, { keepBcc: true });
    return JSON.stringify({
      message: {
        raw: raw.toString("base64url"),
        threadId: message.reply?.kind === "reply" ? message.reply.threadId || undefined : undefined,
      },
    });
  }

  async function deleteDraft(draftId: string) {
    try {
      await request(`/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
    } catch (error) {
      if (!(error instanceof ProviderError && error.status === 404)) throw error;
    }
  }

  /**
   * The draft ID of each draft message. Gmail gives a draft an ID that is not
   * the ID of its message, and a thread does not include it.
   */
  async function draftIds(messages: GmailMessage[]) {
    const ids = new Map<string, string>();
    if (!messages.some((m) => m.labelIds?.includes("DRAFT"))) return ids;
    const params = new URLSearchParams({ maxResults: "500", fields: "drafts(id,message/id)" });
    const list = await request<{ drafts?: { id: string; message: { id: string } }[] }>(`/drafts?${params}`);
    for (const draft of list.drafts ?? []) ids.set(draft.message.id, draft.id);
    return ids;
  }

  const modify = (threadId: string, addLabelIds: string[], removeLabelIds: string[]) =>
    request(`/threads/${encodeURIComponent(threadId)}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    });

  return {
    async listThreads({ folder, unread, query, allMail, cursor, limit, skip }: ListOptions): Promise<ThreadPage> {
      // A Gmail search with no label looks in all mail except spam and trash.
      const { labelIds, q } = allMail ? {} : FOLDER_QUERY[folder];
      const params = new URLSearchParams({ maxResults: String(limit) });
      labelIds?.forEach((id) => params.append("labelIds", id));
      const search = [q, unread && "is:unread", query].filter(Boolean).join(" ");
      if (search) params.set("q", search);
      if (cursor) params.set("pageToken", cursor);
      if (folder === "spam" || folder === "trash") params.set("includeSpamTrash", "true");

      const list = await request<{
        threads?: { id: string; historyId: string }[];
        nextPageToken?: string;
      }>(`/threads?${params}`);

      // Only Sent and Drafts show a different summary, so other folders share one entry.
      const people = folder === "sent" || folder === "drafts" ? "to" : "from";
      const keyFor = (id: string, historyId: string) => `${account.id}:${id}:${historyId}:${people}`;
      const all = list.threads ?? [];
      const skipped = skip ? await skip(all.map((t) => t.id)) : new Set<string>();
      const listed = all.filter((t) => !skipped.has(t.id));
      // The memory cache is first. The database has the summaries from other server instances.
      const misses = listed.filter((t) => !summaryCache.has(keyFor(t.id, t.historyId)));
      const stored = await loadSummaries(account.id, people, misses);
      const fetched: { historyId: string; summary: ThreadSummary }[] = [];

      const threads = await mapLimit(listed, 10, async ({ id, historyId }) => {
        const key = keyFor(id, historyId);
        const cached = summaryCache.get(key) ?? stored.get(id);
        if (cached) {
          cacheSummary(key, cached);
          return cached;
        }
        const metadata = new URLSearchParams({ format: "metadata" });
        ["From", "To", "Subject", "Date", "Message-ID"].forEach((h) => metadata.append("metadataHeaders", h));
        const thread = await request<GmailThread>(`/threads/${encodeURIComponent(id)}?${metadata}`);
        const summary = summarize(thread, folder);
        cacheSummary(key, summary);
        fetched.push({ historyId, summary });
        return summary;
      });
      // The list does not need the write, so the response does not wait for it.
      // On Vercel, waitUntil keeps the function alive until the write ends.
      waitUntil(saveSummaries(account.id, people, fetched));

      return { threads, nextCursor: list.nextPageToken, listed: all.length };
    },

    async getThread(threadId: string): Promise<Thread> {
      const thread = await request<GmailThread>(`/threads/${encodeURIComponent(threadId)}?format=full`);
      const drafts = await draftIds(thread.messages);
      const messages = thread.messages
        // A draft that the app cannot change shows only if it is alone in the conversation.
        .filter((m) => !m.labelIds?.includes("DRAFT") || drafts.has(m.id) || thread.messages.length === 1)
        .map((m) => ({ ...toMessage(m), draftId: drafts.get(m.id) }));
      return {
        accountId: account.id,
        id: thread.id,
        subject: messages[0]?.subject ?? "(no subject)",
        messages,
        starred: messages.some((m) => m.starred),
        unread: messages.some((m) => m.unread),
      };
    },

    async modifyThread(threadId: string, action: ThreadAction) {
      switch (action) {
        case "archive":
          return void (await modify(threadId, [], ["INBOX"]));
        case "inbox":
          await request(`/threads/${encodeURIComponent(threadId)}/untrash`, { method: "POST" });
          return void (await modify(threadId, ["INBOX"], ["SPAM"]));
        case "trash":
          return void (await request(`/threads/${encodeURIComponent(threadId)}/trash`, { method: "POST" }));
        case "spam":
          return void (await modify(threadId, ["SPAM"], ["INBOX"]));
        case "star":
          return void (await modify(threadId, ["STARRED"], []));
        case "unstar":
          return void (await modify(threadId, [], ["STARRED"]));
        case "read":
          return void (await modify(threadId, [], ["UNREAD"]));
        case "unread":
          return void (await modify(threadId, ["UNREAD"], []));
      }
    },

    async send(message: OutgoingMessage, options?: { draftId?: string }) {
      const raw = await buildMime({ name: account.name, email: account.email }, message, {
        keepBcc: true,
      });
      await request("/messages/send", {
        method: "POST",
        body: JSON.stringify({
          raw: raw.toString("base64url"),
          threadId: message.reply?.kind === "reply" ? message.reply.threadId || undefined : undefined,
        }),
      });
      // The message is sent. A draft that stays must not make the send fail.
      if (options?.draftId) await deleteDraft(options.draftId).catch(() => {});
    },

    async saveDraft(message: OutgoingMessage, draftId?: string) {
      const body = await draftBody(message);
      if (draftId) {
        try {
          const draft = await request<{ id: string }>(`/drafts/${encodeURIComponent(draftId)}`, {
            method: "PUT",
            body,
          });
          return { draftId: draft.id };
        } catch (error) {
          // Another mail app deleted or sent the draft. Make a new one.
          if (!(error instanceof ProviderError && error.status === 404)) throw error;
        }
      }
      const draft = await request<{ id: string }>("/drafts", { method: "POST", body });
      return { draftId: draft.id };
    },

    deleteDraft,

    async getAttachment(messageId: string, partId: string) {
      // Gmail attachment IDs change on each request. The part ID is stable,
      // so look up the current attachment ID from the message first.
      const message = await request<GmailMessage>(`/messages/${encodeURIComponent(messageId)}?format=full`);
      let target: GmailPart | undefined;
      walkParts(message.payload, (part) => {
        if (part.partId === partId) target = part;
      });
      if (!target) throw new ProviderError("Attachment not found", 404);
      let data = target.body.data;
      if (!data && target.body.attachmentId) {
        const body = await request<{ data: string }>(
          `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(target.body.attachmentId)}`,
        );
        data = body.data;
      }
      return {
        filename: target.filename || "attachment",
        mimeType: target.mimeType,
        data: Buffer.from(data ?? "", "base64url"),
      };
    },

    async inboxUnread(limit: number) {
      const params = new URLSearchParams({ maxResults: String(limit), fields: "threads/id" });
      params.append("labelIds", "INBOX");
      params.append("labelIds", "UNREAD");
      const [label, list] = await Promise.all([
        request<{ threadsUnread?: number }>("/labels/INBOX"),
        request<{ threads?: { id: string }[] }>(`/threads?${params}`),
      ]);
      return { total: label.threadsUnread ?? 0, threads: (list.threads ?? []).map(({ id }) => ({ id })) };
    },
  };
}
