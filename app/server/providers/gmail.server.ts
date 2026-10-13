import type {
  Address,
  Attachment,
  Folder,
  Message,
  Thread,
  ThreadAction,
  ThreadSummary,
} from "~/lib/mail";
import type { Account } from "../accounts.server";
import { setAccountStatus } from "../accounts.server";
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

const FOLDER_QUERY: Record<Folder, { labelIds?: string[]; q?: string }> = {
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

export function createGmailProvider(account: Account): MailProvider {
  const tokens = createTokenSource(account);

  async function request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await tokens.get()}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (response.status === 401 && attempt === 0) {
      await tokens.refresh();
      return request(path, init, attempt + 1);
    }
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

  function summarize(thread: GmailThread, folder: Folder): ThreadSummary {
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

  const modify = (threadId: string, addLabelIds: string[], removeLabelIds: string[]) =>
    request(`/threads/${encodeURIComponent(threadId)}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    });

  return {
    async listThreads({ folder, query, cursor, limit }: ListOptions): Promise<ThreadPage> {
      const { labelIds, q } = FOLDER_QUERY[folder];
      const params = new URLSearchParams({ maxResults: String(limit) });
      labelIds?.forEach((id) => params.append("labelIds", id));
      const search = [q, query].filter(Boolean).join(" ");
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
      const listed = list.threads ?? [];
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
      await saveSummaries(account.id, people, fetched);

      return { threads, nextCursor: list.nextPageToken };
    },

    async getThread(threadId: string): Promise<Thread> {
      const thread = await request<GmailThread>(`/threads/${encodeURIComponent(threadId)}?format=full`);
      const messages = thread.messages
        .filter((m) => !m.labelIds?.includes("DRAFT") || thread.messages.length === 1)
        .map(toMessage);
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

    async send(message: OutgoingMessage) {
      const raw = await buildMime({ name: account.name, email: account.email }, message, {
        keepBcc: true,
      });
      await request("/messages/send", {
        method: "POST",
        body: JSON.stringify({
          raw: raw.toString("base64url"),
          threadId: message.reply?.kind === "reply" ? message.reply.threadId : undefined,
        }),
      });
    },

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

    async inboxUnreadCount() {
      const label = await request<{ threadsUnread?: number }>("/labels/INBOX");
      return label.threadsUnread ?? 0;
    },
  };
}
