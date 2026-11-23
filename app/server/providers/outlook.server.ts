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
import { createTokenSource } from "../oauth/tokens.server";
import { mapLimit, parseListUnsubscribe } from "../util.server";
import type { ListOptions, MailProvider, OutgoingMessage, ThreadPage } from "./types";
import { ProviderAuthError, ProviderError } from "./types";

const API = "https://graph.microsoft.com/v1.0/me";

// In a Microsoft fault, Graph answers each call with a 5xx error after 20 to 30 seconds.
/** The time limit of one read. A normal read takes less than one second. */
const READ_TIMEOUT_MS = 10_000;
/** No retry starts after this time from the first try. */
const RETRY_BUDGET_MS = 10_000;

type WellKnownFolder = "inbox" | "sentitems" | "drafts" | "archive" | "junkemail" | "deleteditems";

const WELL_KNOWN: Record<Exclude<MailboxFolder, "starred">, WellKnownFolder> = {
  inbox: "inbox",
  sent: "sentitems",
  drafts: "drafts",
  archive: "archive",
  spam: "junkemail",
  trash: "deleteditems",
};

interface GraphRecipient {
  emailAddress: { name?: string; address: string };
}

interface GraphMessage {
  id: string;
  conversationId: string;
  parentFolderId: string;
  subject?: string;
  bodyPreview: string;
  body?: { contentType: "html" | "text"; content: string };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  replyTo?: GraphRecipient[];
  receivedDateTime: string;
  isRead: boolean;
  isDraft?: boolean;
  flag?: { flagStatus: "notFlagged" | "flagged" | "complete" };
  hasAttachments: boolean;
  internetMessageId?: string;
  internetMessageHeaders?: { name: string; value: string }[];
}

interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentId?: string;
  contentBytes?: string;
}

const LIST_FIELDS =
  "id,conversationId,parentFolderId,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,flag,hasAttachments,internetMessageId";
const FULL_FIELDS = `${LIST_FIELDS},body,ccRecipients,bccRecipients,replyTo,isDraft,internetMessageHeaders`;

// Outlook keeps only the HTML body of a draft. This property of the message
// keeps the text part, which is the Markdown that the person wrote.
const DRAFT_TEXT_PROPERTY = "String {7d5c0a3e-52f4-4b0e-9f0b-2f6c1e8a4d11} Name MailDraftText";

// Graph conversation IDs are URL-safe base64 ("-" and "_"), with "=" padding.
// URLs drop the padding. Do not change "-" or "_": Graph needs them as they are.
const encodeId = (id: string) => id.replace(/=+$/, "");
const decodeId = (id: string) => id + "=".repeat((4 - (id.length % 4)) % 4);

const toAddress = (recipient?: GraphRecipient): Address => ({
  name: recipient?.emailAddress.name || undefined,
  email: recipient?.emailAddress.address ?? "unknown",
});

const toRecipient = (address: Address): GraphRecipient => ({
  emailAddress: { name: address.name, address: address.email },
});

const internetHeader = (message: GraphMessage, name: string) =>
  message.internetMessageHeaders?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

// Well-known folder IDs never change, so keep them for the life of the process.
const folderIdCache = new Map<string, Map<WellKnownFolder, string>>();

export function createOutlookProvider(account: Account): MailProvider {
  const tokens = createTokenSource(account);
  const folderIds = folderIdCache.get(account.id) ?? new Map<WellKnownFolder, string>();
  folderIdCache.set(account.id, folderIds);

  async function request<T>(
    pathOrUrl: string,
    init: RequestInit = {},
    attempt = 0,
    retryUntil = Date.now() + RETRY_BUDGET_MS,
  ): Promise<T> {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${API}${pathOrUrl}`;
    const read = !init.method || init.method === "GET";
    const response = await fetch(url, {
      ...init,
      // A change, such as a send, has no time limit: a stop in the middle does not tell if it took effect.
      signal: read ? AbortSignal.timeout(READ_TIMEOUT_MS) : init.signal,
      headers: {
        Authorization: `Bearer ${await tokens.get()}`,
        "Content-Type": "application/json",
        Prefer: 'outlook.body-content-type="html"',
        ...init.headers,
      },
    }).catch((error) => {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new ProviderError("Microsoft did not answer in time", 504);
      }
      throw error;
    });
    if (response.status === 401 && attempt === 0) {
      await tokens.refresh();
      return request(pathOrUrl, init, attempt + 1, retryUntil);
    }
    if (response.status === 401) {
      await setAccountStatus(account.id, "reauth_required");
      throw new ProviderAuthError();
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After")) || 2 ** attempt;
      if (Date.now() + retryAfter * 1000 < retryUntil) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        return request(pathOrUrl, init, attempt + 1, retryUntil);
      }
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new ProviderError(
        body.error?.message ?? `Microsoft Graph error ${response.status}`,
        response.status,
      );
    }
    if (response.status === 202 || response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async function folderId(name: WellKnownFolder) {
    let id = folderIds.get(name);
    if (!id) {
      id = (await request<{ id: string }>(`/mailFolders/${name}?$select=id`)).id;
      folderIds.set(name, id);
    }
    return id;
  }

  async function conversationMessages(conversationId: string, fields: string) {
    const filter = `conversationId eq '${conversationId.replace(/'/g, "''")}'`;
    const params = new URLSearchParams({ $filter: filter, $select: fields, $top: "100" });
    const result = await request<{ value: GraphMessage[] }>(`/messages?${params}`);
    return result.value.sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
  }

  function summarize(messages: GraphMessage[], folder: MailboxFolder): ThreadSummary {
    // `messages` is newest first.
    const latest = messages[0];
    const oldest = messages[messages.length - 1];
    const people =
      folder === "sent" || folder === "drafts"
        ? messages.flatMap((m) => (m.toRecipients ?? []).map(toAddress))
        : messages.map((m) => toAddress(m.from));
    const seen = new Set<string>();
    return {
      accountId: account.id,
      id: encodeId(latest.conversationId),
      subject: oldest.subject || "(no subject)",
      snippet: latest.bodyPreview,
      participants: people.filter((p) => !seen.has(p.email) && seen.add(p.email)),
      date: latest.receivedDateTime,
      unread: messages.some((m) => !m.isRead),
      starred: messages.some((m) => m.flag?.flagStatus === "flagged"),
      messageCount: messages.length,
      hasAttachments: messages.some((m) => m.hasAttachments),
      messageIds: messages.map((m) => m.internetMessageId).filter((id): id is string => !!id),
    };
  }

  const notFound = (error: unknown) => error instanceof ProviderError && error.status === 404;

  /** The fields of a message that a draft and a sent message have in common. */
  const content = (message: OutgoingMessage) => ({
    subject: message.subject,
    body: { contentType: "HTML", content: message.html },
    toRecipients: message.to.map(toRecipient),
    ccRecipients: message.cc.map(toRecipient),
    bccRecipients: message.bcc.map(toRecipient),
  });

  /** Makes an empty draft. createReply and createForward keep the conversation in Outlook. */
  async function createDraft(message: OutgoingMessage) {
    if (message.reply?.messageId) {
      const endpoint = message.reply.kind === "forward" ? "createForward" : "createReply";
      const draft = await request<{ id: string }>(
        `/messages/${encodeURIComponent(message.reply.messageId)}/${endpoint}`,
        { method: "POST", body: "{}" },
      );
      return draft.id;
    }
    return (await request<{ id: string }>("/messages", { method: "POST", body: "{}" })).id;
  }

  async function deleteDraft(draftId: string) {
    try {
      await request(`/messages/${encodeURIComponent(draftId)}`, { method: "DELETE" });
    } catch (error) {
      if (!notFound(error)) throw error;
    }
  }

  /** The text part of a draft that the app saved. */
  async function draftText(draftId: string) {
    const params = new URLSearchParams({
      $select: "id",
      $expand: `singleValueExtendedProperties($filter=id eq '${DRAFT_TEXT_PROPERTY}')`,
    });
    const draft = await request<{ singleValueExtendedProperties?: { value: string }[] }>(
      `/messages/${encodeURIComponent(draftId)}?${params}`,
    );
    return draft.singleValueExtendedProperties?.[0]?.value;
  }

  async function sendDraft(draftId: string, message: OutgoingMessage) {
    await mapLimit(message.attachments, 3, (attachment) =>
      request(`/messages/${encodeURIComponent(draftId)}/attachments`, {
        method: "POST",
        body: JSON.stringify({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: attachment.filename,
          contentType: attachment.contentType,
          contentBytes: attachment.content.toString("base64"),
        }),
      }),
    );
    await request(`/messages/${encodeURIComponent(draftId)}/send`, { method: "POST" });
  }

  return {
    async listThreads({ folder, unread, query, allMail, cursor, limit }: ListOptions): Promise<ThreadPage> {
      // The cursor is a Graph nextLink that came back from the browser. Accept
      // only Graph URLs, so the access token never goes to another host.
      if (cursor && !cursor.startsWith(`${API}/`)) throw new ProviderError("Invalid cursor", 400);
      let url = cursor;
      if (!url) {
        const params = new URLSearchParams({ $top: String(limit), $select: LIST_FIELDS });
        // Graph does not allow $orderby or $filter together with $search.
        if (query) params.set("$search", `"${query.replace(/"/g, "")}"`);
        else params.set("$orderby", "receivedDateTime desc");
        // Graph sorts a filtered list only if the filter starts with the sort property.
        if (unread && !query) params.set("$filter", "receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false");
        if (allMail) {
          // The messages of all folders.
          url = `${API}/messages?${params}`;
        } else if (folder === "starred") {
          params.set("$filter", "flag/flagStatus eq 'flagged'");
          params.delete("$orderby");
          url = `${API}/messages?${params}`;
        } else {
          url = `${API}/mailFolders/${WELL_KNOWN[folder]}/messages?${params}`;
        }
      }
      const page = await request<{ value: GraphMessage[]; "@odata.nextLink"?: string }>(url);
      // A search cannot have a filter, so remove the read messages here.
      if (unread && query) page.value = page.value.filter((m) => !m.isRead);
      // A search of all folders also finds junk and deleted mail. Remove it here.
      if (allMail) {
        const hidden = await Promise.all((["junkemail", "deleteditems"] as const).map(folderId));
        page.value = page.value.filter((m) => !hidden.includes(m.parentFolderId));
      }

      // Graph lists messages. Group the messages on this page into conversations.
      const groups = new Map<string, GraphMessage[]>();
      for (const message of page.value) {
        const group = groups.get(message.conversationId) ?? [];
        group.push(message);
        groups.set(message.conversationId, group);
      }
      const threads = [...groups.values()]
        .map((group) =>
          summarize(
            group.sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime)),
            folder,
          ),
        )
        .sort((a, b) => b.date.localeCompare(a.date));
      return { threads, nextCursor: page["@odata.nextLink"] };
    },

    async getThread(threadId: string): Promise<Thread> {
      const raw = await conversationMessages(decodeId(threadId), FULL_FIELDS);
      if (!raw.length) throw new ProviderError("Conversation not found", 404);
      const messages = await mapLimit(raw, 4, async (m): Promise<Message> => {
        const html = m.body?.contentType === "html" ? m.body.content : undefined;
        let attachments: Attachment[] = [];
        if (m.hasAttachments || html?.includes("cid:")) {
          // contentId is only on file attachments, and $select cannot ask for
          // it. Ask for the full objects only if the body shows inline images.
          const select = html?.includes("cid:") ? "" : "?$select=id,name,contentType,size,isInline";
          const list = await request<{ value: GraphAttachment[] }>(
            `/messages/${encodeURIComponent(m.id)}/attachments${select}`,
          );
          attachments = list.value.map((a) => ({
            id: a.id,
            filename: a.name,
            mimeType: a.contentType,
            size: a.size,
            contentId: a.contentId?.replace(/^<|>$/g, ""),
            inline: a.isInline,
          }));
        }
        // A draft from another mail app has no text part. That is not an error.
        const text = m.isDraft ? await draftText(m.id).catch(() => undefined) : undefined;
        return {
          id: m.id,
          threadId,
          draftId: m.isDraft ? m.id : undefined,
          from: toAddress(m.from),
          to: (m.toRecipients ?? []).map(toAddress),
          cc: (m.ccRecipients ?? []).map(toAddress),
          bcc: (m.bccRecipients ?? []).map(toAddress),
          replyTo: (m.replyTo ?? []).map(toAddress),
          subject: m.subject || "(no subject)",
          date: m.receivedDateTime,
          snippet: m.bodyPreview,
          html,
          text: m.body?.contentType === "text" ? m.body.content : text,
          unread: !m.isRead,
          starred: m.flag?.flagStatus === "flagged",
          attachments,
          messageIdHeader: m.internetMessageId,
          unsubscribe: parseListUnsubscribe(
            internetHeader(m, "List-Unsubscribe"),
            internetHeader(m, "List-Unsubscribe-Post"),
          ),
        };
      });
      return {
        accountId: account.id,
        id: threadId,
        subject: messages[0].subject,
        messages,
        starred: messages.some((m) => m.starred),
        unread: messages.some((m) => m.unread),
      };
    },

    async modifyThread(threadId: string, action: ThreadAction) {
      const messages = await conversationMessages(
        decodeId(threadId),
        "id,parentFolderId,isRead,flag,receivedDateTime",
      );
      const [inbox, sent, drafts, archive, junk, deleted] = await Promise.all(
        (["inbox", "sentitems", "drafts", "archive", "junkemail", "deleteditems"] as const).map(
          folderId,
        ),
      );
      const move = (filter: (m: GraphMessage) => boolean, destination: WellKnownFolder) =>
        mapLimit(messages.filter(filter), 4, (m) =>
          request(`/messages/${encodeURIComponent(m.id)}/move`, {
            method: "POST",
            body: JSON.stringify({ destinationId: destination }),
          }),
        );
      const patch = (filter: (m: GraphMessage) => boolean, body: object) =>
        mapLimit(messages.filter(filter), 4, (m) =>
          request(`/messages/${encodeURIComponent(m.id)}`, { method: "PATCH", body: JSON.stringify(body) }),
        );
      const inFolder = (...ids: string[]) => (m: GraphMessage) => ids.includes(m.parentFolderId);

      switch (action) {
        case "archive":
          await move(inFolder(inbox), "archive");
          break;
        case "inbox":
          await move(inFolder(archive, junk, deleted), "inbox");
          break;
        case "trash":
          await move((m) => m.parentFolderId !== deleted && m.parentFolderId !== drafts, "deleteditems");
          break;
        case "spam":
          await move(inFolder(inbox), "junkemail");
          break;
        case "star": {
          const latest = messages.filter((m) => m.parentFolderId !== sent).at(-1) ?? messages.at(-1);
          if (latest) await patch((m) => m.id === latest.id, { flag: { flagStatus: "flagged" } });
          break;
        }
        case "unstar":
          await patch((m) => m.flag?.flagStatus === "flagged", { flag: { flagStatus: "notFlagged" } });
          break;
        case "read":
          await patch((m) => !m.isRead, { isRead: true });
          break;
        case "unread": {
          const latest = messages.filter((m) => m.parentFolderId !== sent).at(-1);
          if (latest) await patch((m) => m.id === latest.id, { isRead: false });
          break;
        }
      }
    },

    async send(message: OutgoingMessage, options?: { draftId?: string }) {
      if (options?.draftId) {
        // Send the draft itself, so a reply draft keeps its conversation.
        try {
          await request(`/messages/${encodeURIComponent(options.draftId)}`, {
            method: "PATCH",
            body: JSON.stringify(content(message)),
          });
          return await sendDraft(options.draftId, message);
        } catch (error) {
          // Another mail app deleted the draft. Send the message as a new one.
          if (!notFound(error)) throw error;
        }
      }
      if (!message.reply?.messageId && message.attachments.length === 0) {
        await request("/sendMail", {
          method: "POST",
          body: JSON.stringify({ message: content(message), saveToSentItems: true }),
        });
        return;
      }
      const draftId = await createDraft(message);
      await request(`/messages/${encodeURIComponent(draftId)}`, {
        method: "PATCH",
        body: JSON.stringify(content(message)),
      });
      await sendDraft(draftId, message);
    },

    async saveDraft(message: OutgoingMessage, draftId?: string) {
      const fields = content(message);
      const write = (id: string, body: object) =>
        request(`/messages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
      // If Graph rejects the text property, the draft saves with the HTML body only.
      const save = (id: string) =>
        write(id, {
          ...fields,
          singleValueExtendedProperties: [{ id: DRAFT_TEXT_PROPERTY, value: message.text }],
        }).catch((error) => {
          if (!(error instanceof ProviderError && error.status === 400)) throw error;
          return write(id, fields);
        });
      if (draftId) {
        try {
          await save(draftId);
          return { draftId };
        } catch (error) {
          // Another mail app deleted or sent the draft. Make a new one.
          if (!notFound(error)) throw error;
        }
      }
      const id = await createDraft(message);
      await save(id);
      return { draftId: id };
    },

    deleteDraft,

    async getAttachment(messageId: string, attachmentId: string) {
      const attachment = await request<GraphAttachment>(
        `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      );
      return {
        filename: attachment.name,
        mimeType: attachment.contentType,
        data: Buffer.from(attachment.contentBytes ?? "", "base64"),
      };
    },

    async inboxUnread(limit: number) {
      const params = new URLSearchParams({
        $top: String(limit),
        $select: "conversationId",
        $filter: "isRead eq false",
      });
      const [folder, page] = await Promise.all([
        request<{ unreadItemCount: number }>("/mailFolders/inbox?$select=unreadItemCount"),
        request<{ value: { conversationId: string }[] }>(`/mailFolders/inbox/messages?${params}`),
      ]);
      return {
        total: folder.unreadItemCount,
        threads: page.value.map((m) => ({ id: encodeId(m.conversationId) })),
      };
    },
  };
}
