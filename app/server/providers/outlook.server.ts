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
import { mapLimit, parseListUnsubscribe } from "../util.server";
import type { ListOptions, MailProvider, OutgoingMessage, ThreadPage } from "./types";
import { ProviderAuthError, ProviderError } from "./types";

const API = "https://graph.microsoft.com/v1.0/me";

type WellKnownFolder = "inbox" | "sentitems" | "drafts" | "archive" | "junkemail" | "deleteditems";

const WELL_KNOWN: Record<Exclude<Folder, "starred">, WellKnownFolder> = {
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

// Graph conversation IDs are standard base64. URLs need a URL-safe form.
const encodeId = (id: string) => id.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function decodeId(id: string) {
  const base64 = id.replace(/-/g, "+").replace(/_/g, "/");
  return base64 + "=".repeat((4 - (base64.length % 4)) % 4);
}

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

  async function request<T>(pathOrUrl: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${API}${pathOrUrl}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${await tokens.get()}`,
        "Content-Type": "application/json",
        Prefer: 'outlook.body-content-type="html"',
        ...init.headers,
      },
    });
    if (response.status === 401 && attempt === 0) {
      await tokens.refresh();
      return request(pathOrUrl, init, attempt + 1);
    }
    if (response.status === 401) {
      await setAccountStatus(account.id, "reauth_required");
      throw new ProviderAuthError();
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After")) || 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return request(pathOrUrl, init, attempt + 1);
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

  function summarize(messages: GraphMessage[], folder: Folder): ThreadSummary {
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
    async listThreads({ folder, query, cursor, limit }: ListOptions): Promise<ThreadPage> {
      // The cursor is a Graph nextLink that came back from the browser. Accept
      // only Graph URLs, so the access token never goes to another host.
      if (cursor && !cursor.startsWith(`${API}/`)) throw new ProviderError("Invalid cursor", 400);
      let url = cursor;
      if (!url) {
        const params = new URLSearchParams({ $top: String(limit), $select: LIST_FIELDS });
        // Graph does not allow $orderby together with $search.
        if (query) params.set("$search", `"${query.replace(/"/g, "")}"`);
        else params.set("$orderby", "receivedDateTime desc");
        if (folder === "starred") {
          params.set("$filter", "flag/flagStatus eq 'flagged'");
          params.delete("$orderby");
          url = `${API}/messages?${params}`;
        } else {
          url = `${API}/mailFolders/${WELL_KNOWN[folder]}/messages?${params}`;
        }
      }
      const page = await request<{ value: GraphMessage[]; "@odata.nextLink"?: string }>(url);

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
        return {
          id: m.id,
          threadId,
          from: toAddress(m.from),
          to: (m.toRecipients ?? []).map(toAddress),
          cc: (m.ccRecipients ?? []).map(toAddress),
          bcc: (m.bccRecipients ?? []).map(toAddress),
          replyTo: (m.replyTo ?? []).map(toAddress),
          subject: m.subject || "(no subject)",
          date: m.receivedDateTime,
          snippet: m.bodyPreview,
          html,
          text: m.body?.contentType === "text" ? m.body.content : undefined,
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

    async send(message: OutgoingMessage) {
      const recipients = {
        toRecipients: message.to.map(toRecipient),
        ccRecipients: message.cc.map(toRecipient),
        bccRecipients: message.bcc.map(toRecipient),
      };
      if (message.reply) {
        // createReply and createForward keep the conversation in Outlook.
        const endpoint = message.reply.kind === "forward" ? "createForward" : "createReply";
        const draft = await request<{ id: string }>(
          `/messages/${encodeURIComponent(message.reply.messageId)}/${endpoint}`,
          { method: "POST", body: "{}" },
        );
        await request(`/messages/${encodeURIComponent(draft.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            subject: message.subject,
            body: { contentType: "HTML", content: message.html },
            ...recipients,
          }),
        });
        return sendDraft(draft.id, message);
      }
      if (message.attachments.length === 0) {
        await request("/sendMail", {
          method: "POST",
          body: JSON.stringify({
            message: {
              subject: message.subject,
              body: { contentType: "HTML", content: message.html },
              ...recipients,
            },
            saveToSentItems: true,
          }),
        });
        return;
      }
      const draft = await request<{ id: string }>("/messages", {
        method: "POST",
        body: JSON.stringify({
          subject: message.subject,
          body: { contentType: "HTML", content: message.html },
          ...recipients,
        }),
      });
      await sendDraft(draft.id, message);
    },

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

    async inboxUnreadCount() {
      const folder = await request<{ unreadItemCount: number }>(
        "/mailFolders/inbox?$select=unreadItemCount",
      );
      return folder.unreadItemCount;
    },
  };
}
