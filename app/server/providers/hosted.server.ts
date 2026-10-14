import { randomUUID } from "node:crypto";
import { simpleParser } from "mailparser";
import type { Address, Folder, Thread, ThreadAction, ThreadSummary } from "~/lib/mail";
import type { Account } from "../accounts.server";
import { query, queryOne } from "../db.server";
import { getSentMessageId, sendWithResend } from "../resend.server";
import { buildMime, snippetFromText } from "../util.server";
import { fromParsed, messageFromParsed } from "./imap.server";
import type { ListOptions, MailProvider, OutgoingMessage, ThreadPage } from "./types";
import { ProviderError } from "./types";

// Mail for the addresses that mail hosts, in the hosted_messages table.
// A thread ID is the thread_id column. A message ID is the row ID.

type StoredFolder = "inbox" | "sent" | "archive" | "spam" | "trash";

const FOLDER_FILTER: Record<Folder, string> = {
  inbox: "folder = 'inbox'",
  starred: "starred AND folder NOT IN ('spam', 'trash')",
  sent: "folder = 'sent'",
  // mail does not save drafts for hosted addresses.
  drafts: "false",
  archive: "folder = 'archive'",
  spam: "folder = 'spam'",
  trash: "folder = 'trash'",
};

/**
 * The messages that a list row summarizes. A conversation in Inbox also shows
 * the replies in Sent. Spam and Trash show only their own messages.
 */
const SUMMARY_FILTER: Record<Folder, string> = {
  ...Object.fromEntries(Object.keys(FOLDER_FILTER).map((folder) => [folder, "folder NOT IN ('spam', 'trash')"])),
  spam: FOLDER_FILTER.spam,
  trash: FOLDER_FILTER.trash,
} as Record<Folder, string>;

interface SummaryRow {
  id: string;
  thread_id: string;
  subject: string;
  snippet: string;
  from_address: Address;
  to_addresses: Address[];
  date: string | Date;
  unread: boolean;
  starred: boolean;
  has_attachments: boolean;
  message_id: string | null;
  outgoing: boolean;
}

/** Normalizes a Message-ID to the form with angle brackets. */
function normalizeMessageId(id: string | undefined | null) {
  if (!id) return undefined;
  const trimmed = id.trim();
  return trimmed.startsWith("<") ? trimmed : `<${trimmed}>`;
}

/**
 * Stores a message in a mailbox. The message joins the thread of a stored
 * message that it refers to with In-Reply-To or References.
 */
export async function storeMessage(input: {
  mailbox: string;
  raw: Buffer;
  folder: StoredFolder;
  outgoing: boolean;
  unread: boolean;
  sourceId?: string;
  threadId?: string;
  /** The Message-ID that the recipients got is not known yet. resolvePendingMessageIds sets it later. */
  pendingMessageId?: boolean;
}) {
  const mailbox = input.mailbox.toLowerCase();
  const parsed = await simpleParser(input.raw);
  const messageId = input.pendingMessageId ? undefined : normalizeMessageId(parsed.messageId);
  const references = [
    ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []),
    ...(parsed.inReplyTo ? [parsed.inReplyTo] : []),
  ]
    .map(normalizeMessageId)
    .filter((id): id is string => !!id);

  let threadId = input.threadId;
  if (!threadId && references.length) {
    const parent = await queryOne<{ thread_id: string }>(
      `SELECT thread_id FROM hosted_messages WHERE mailbox = $1 AND message_id = ANY($2)
       ORDER BY date DESC LIMIT 1`,
      [mailbox, references],
    );
    threadId = parent?.thread_id;
  }

  const id = randomUUID();
  const rows = await query<{ id: string }>(
    `INSERT INTO hosted_messages (id, mailbox, thread_id, folder, outgoing, unread, date, message_id,
       subject, from_address, to_addresses, snippet, body_text, has_attachments, raw, source_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, decode($15, 'base64'), $16)
     ON CONFLICT (source_id) DO NOTHING
     RETURNING id`,
    [
      id,
      mailbox,
      threadId ?? randomUUID(),
      input.folder,
      input.outgoing,
      input.unread,
      (parsed.date ?? new Date()).toISOString(),
      messageId ?? null,
      parsed.subject ?? "",
      JSON.stringify(fromParsed(parsed.from)[0] ?? { email: "unknown" }),
      JSON.stringify([
        ...fromParsed(parsed.to),
        ...fromParsed(parsed.cc),
        // Only the stored copy of a sent message has a Bcc header.
        ...fromParsed(parsed.bcc),
      ]),
      snippetFromText(parsed.text),
      parsed.text ?? "",
      parsed.attachments.some((a) => a.contentDisposition !== "inline" && !a.related),
      input.raw.toString("base64"),
      input.sourceId ?? null,
    ],
  );
  return rows[0]?.id;
}

/**
 * Sets the Message-ID of sent messages that did not have one when they were
 * stored. Thus a reply to such a message finds its thread. Resend keeps
 * messages for 30 days, so older rows cannot get an ID.
 */
export async function resolvePendingMessageIds(mailbox: string) {
  const pending = await query<{ id: string; source_id: string }>(
    `SELECT id, source_id FROM hosted_messages
     WHERE mailbox = $1 AND outgoing AND message_id IS NULL AND source_id LIKE 'sent:%'
       AND created_at > now() - interval '30 days'
     ORDER BY date DESC`,
    [mailbox.toLowerCase()],
  );
  for (const row of pending) {
    const messageId = normalizeMessageId(await getSentMessageId(row.source_id.slice("sent:".length)));
    if (messageId) await query("UPDATE hosted_messages SET message_id = $1 WHERE id = $2", [messageId, row.id]);
  }
}

/** Escapes the wildcard characters of a LIKE pattern. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function createHostedProvider(account: Account): MailProvider {
  const mailbox = account.email.toLowerCase();

  function summarize(folder: Folder, rows: SummaryRow[]): ThreadSummary {
    // The rows are in date order, oldest first.
    const latest = rows[rows.length - 1];
    const people = new Map<string, Address>();
    for (const row of rows) {
      // Sent shows the recipients of the sent messages. Other folders show the senders.
      if (folder === "sent" && !row.outgoing) continue;
      const list = folder === "sent" ? row.to_addresses : [row.from_address];
      for (const address of list) people.set(address.email.toLowerCase(), address);
    }
    return {
      accountId: account.id,
      id: latest.thread_id,
      subject: rows[0].subject || "(no subject)",
      snippet: latest.snippet,
      participants: [...people.values()],
      date: new Date(latest.date).toISOString(),
      unread: rows.some((r) => r.unread),
      starred: rows.some((r) => r.starred),
      messageCount: rows.length,
      hasAttachments: rows.some((r) => r.has_attachments),
      messageIds: rows.map((r) => r.message_id).filter((id): id is string => !!id),
    };
  }

  async function threadRows(threadId: string) {
    const rows = await query<SummaryRow & { raw: string; folder: string }>(
      `SELECT id, thread_id, unread, starred, folder, message_id, encode(raw, 'base64') AS raw
       FROM hosted_messages WHERE mailbox = $1 AND thread_id = $2 ORDER BY date`,
      [mailbox, threadId],
    );
    if (rows.length === 0) throw new ProviderError("Message not found", 404);
    return rows;
  }

  async function update(threadId: string, set: string, where = "true") {
    await query(`UPDATE hosted_messages SET ${set} WHERE mailbox = $1 AND thread_id = $2 AND ${where}`, [
      mailbox,
      threadId,
    ]);
  }

  return {
    async listThreads({ folder, query: search, cursor, limit }: ListOptions): Promise<ThreadPage> {
      const filter = FOLDER_FILTER[folder];
      const offset = Number(cursor) || 0;
      const params: unknown[] = [mailbox, limit + 1, offset];
      let searchFilter = "";
      if (search) {
        params.push(likePattern(search));
        searchFilter = `AND (subject ILIKE $4 OR from_address::text ILIKE $4
          OR to_addresses::text ILIKE $4 OR body_text ILIKE $4)`;
      }
      const page = await query<{ thread_id: string }>(
        `SELECT thread_id, max(date) AS latest FROM hosted_messages
         WHERE mailbox = $1 AND ${filter} ${searchFilter}
         GROUP BY thread_id ORDER BY latest DESC LIMIT $2 OFFSET $3`,
        params,
      );
      const more = page.length > limit;
      const ids = page.slice(0, limit).map((row) => row.thread_id);
      if (ids.length === 0) return { threads: [] };

      const rows = await query<SummaryRow>(
        `SELECT id, thread_id, subject, snippet, from_address, to_addresses, date, unread, starred,
           has_attachments, message_id, outgoing
         FROM hosted_messages WHERE mailbox = $1 AND thread_id = ANY($2) AND ${SUMMARY_FILTER[folder]}
         ORDER BY date`,
        [mailbox, ids],
      );
      const byThread = new Map<string, SummaryRow[]>();
      for (const row of rows) byThread.set(row.thread_id, [...(byThread.get(row.thread_id) ?? []), row]);
      return {
        threads: ids.filter((id) => byThread.has(id)).map((id) => summarize(folder, byThread.get(id)!)),
        nextCursor: more ? String(offset + limit) : undefined,
      };
    },

    async getThread(threadId: string): Promise<Thread> {
      const rows = await threadRows(threadId);
      const messages = await Promise.all(
        rows.map(async (row) => {
          const message = messageFromParsed(await simpleParser(Buffer.from(row.raw, "base64")), {
            id: row.id,
            threadId,
            unread: row.unread,
            starred: row.starred,
          });
          // A sent copy has the Message-ID that the recipients got, not the one in its raw message.
          return row.message_id ? { ...message, messageIdHeader: row.message_id } : message;
        }),
      );
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
      switch (action) {
        case "archive":
          return update(threadId, "folder = 'archive'", "folder = 'inbox'");
        case "inbox":
          await update(threadId, "folder = 'inbox'", "NOT outgoing AND folder <> 'inbox'");
          return update(threadId, "folder = 'sent'", "outgoing");
        case "trash":
          return update(threadId, "folder = 'trash'");
        case "spam":
          return update(threadId, "folder = 'spam'", "NOT outgoing");
        case "star":
          return update(threadId, "starred = true");
        case "unstar":
          return update(threadId, "starred = false");
        case "read":
          return update(threadId, "unread = false");
        case "unread":
          return update(threadId, "unread = true");
      }
    },

    async send(message: OutgoingMessage) {
      const from = { name: account.name || undefined, email: account.email };
      const { id, messageId } = await sendWithResend(from, message);
      // Keep a copy in Sent. A reply or a forward stays in its thread.
      const threadId = message.reply?.threadId;
      const known =
        threadId &&
        (await queryOne("SELECT 1 FROM hosted_messages WHERE mailbox = $1 AND thread_id = $2", [mailbox, threadId]));
      await storeMessage({
        mailbox,
        raw: await buildMime(from, message, { keepBcc: true, messageId }),
        folder: "sent",
        outgoing: true,
        unread: false,
        sourceId: `sent:${id}`,
        threadId: known ? threadId : undefined,
        pendingMessageId: !messageId,
      });
    },

    async getAttachment(messageId: string, attachmentId: string) {
      const row = await queryOne<{ raw: string }>(
        "SELECT encode(raw, 'base64') AS raw FROM hosted_messages WHERE mailbox = $1 AND id = $2",
        [mailbox, messageId],
      );
      if (!row) throw new ProviderError("Message not found", 404);
      const parsed = await simpleParser(Buffer.from(row.raw, "base64"));
      const attachment = parsed.attachments[Number(attachmentId)];
      if (!attachment) throw new ProviderError("Attachment not found", 404);
      return {
        filename: attachment.filename || "attachment",
        mimeType: attachment.contentType,
        data: attachment.content,
      };
    },

    async inboxUnreadCount() {
      const row = await queryOne<{ count: number }>(
        `SELECT COUNT(DISTINCT thread_id)::int AS count FROM hosted_messages
         WHERE mailbox = $1 AND folder = 'inbox' AND unread`,
        [mailbox],
      );
      return row?.count ?? 0;
    },
  };
}
