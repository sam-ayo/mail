import { ImapFlow } from "imapflow";
import type { FetchMessageObject, ListResponse, MessageAddressObject } from "imapflow";
import { simpleParser } from "mailparser";
import type { AddressObject, ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import type { Address, Folder, Message, Thread, ThreadAction, ThreadSummary } from "~/lib/mail";
import type { Account, ImapCredentials } from "../accounts.server";
import { setAccountStatus } from "../accounts.server";
import { buildMime, parseListUnsubscribe, snippetFromText } from "../util.server";
import type { ListOptions, MailProvider, OutgoingMessage, ThreadPage } from "./types";
import { ProviderAuthError, ProviderError } from "./types";

type SpecialFolder = Exclude<Folder, "inbox">;

const SPECIAL_USE: Record<SpecialFolder, string[]> = {
  starred: ["\\Flagged"],
  sent: ["\\Sent"],
  drafts: ["\\Drafts"],
  archive: ["\\Archive", "\\All"],
  spam: ["\\Junk"],
  trash: ["\\Trash"],
};

const NAME_FALLBACK: Record<SpecialFolder, RegExp> = {
  starred: /^(starred|flagged)$/i,
  sent: /^(sent|sent items|sent messages|sent mail)$/i,
  drafts: /^drafts?$/i,
  archive: /^(archive|archives|all mail)$/i,
  spam: /^(spam|junk|junk e-?mail|bulk mail)$/i,
  trash: /^(trash|deleted|deleted items|deleted messages|bin)$/i,
};

// Servers that save sent mail on their own. For other servers, the app
// appends a copy to the Sent folder.
const AUTO_SAVES_SENT = /(^|\.)(gmail\.com|googlemail\.com|office365\.com|outlook\.com)$/i;

interface PooledConnection {
  client: ImapFlow;
  ready: Promise<void>;
  idleTimer?: NodeJS.Timeout;
  mailboxes?: Promise<ListResponse[]>;
}

const IDLE_TIMEOUT = 5 * 60_000;
const globalPool = globalThis as unknown as { __imapPool?: Map<string, PooledConnection> };
const pool = (globalPool.__imapPool ??= new Map<string, PooledConnection>());

function createClient(credentials: ImapCredentials) {
  return new ImapFlow({
    host: credentials.imap.host,
    port: credentials.imap.port,
    secure: credentials.imap.secure,
    auth: { user: credentials.user, pass: credentials.password },
    logger: false,
  });
}

function isAuthFailure(error: unknown) {
  const e = error as { authenticationFailed?: boolean; serverResponseCode?: string };
  return !!e?.authenticationFailed || e?.serverResponseCode === "AUTHENTICATIONFAILED";
}

function connection(account: Account): PooledConnection {
  const existing = pool.get(account.id);
  if (existing && existing.client.usable !== false) {
    clearTimeout(existing.idleTimer);
    existing.idleTimer = setTimeout(() => close(account.id), IDLE_TIMEOUT);
    return existing;
  }

  const client = createClient(account.credentials as ImapCredentials);
  const entry: PooledConnection = {
    client,
    ready: client.connect().catch(async (error) => {
      pool.delete(account.id);
      if (isAuthFailure(error)) {
        await setAccountStatus(account.id, "reauth_required");
        throw new ProviderAuthError("The mail server rejected the password");
      }
      throw new ProviderError(`Could not connect to ${account.email}: ${error.message}`);
    }),
  };
  client.on("error", () => pool.delete(account.id));
  client.on("close", () => pool.delete(account.id));
  entry.idleTimer = setTimeout(() => close(account.id), IDLE_TIMEOUT);
  pool.set(account.id, entry);
  return entry;
}

/** Closes the pooled connection, for example after the password changes. */
export function closeImapConnection(accountId: string) {
  close(accountId);
}

function close(accountId: string) {
  const entry = pool.get(accountId);
  pool.delete(accountId);
  entry?.client.logout().catch(() => {});
}

/** Connects and logs in with the credentials, then logs out. Throws on failure. */
export async function verifyImapCredentials(credentials: ImapCredentials) {
  const client = createClient(credentials);
  try {
    await client.connect();
  } catch (error) {
    if (isAuthFailure(error)) throw new Error("The IMAP server rejected the user name or password.");
    throw new Error(`Could not connect to the IMAP server: ${(error as Error).message}`);
  }
  await client.logout();

  const transport = nodemailer.createTransport({
    host: credentials.smtp.host,
    port: credentials.smtp.port,
    secure: credentials.smtp.secure,
    auth: { user: credentials.user, pass: credentials.password },
  });
  try {
    await transport.verify();
  } catch (error) {
    throw new Error(`Could not connect to the SMTP server: ${(error as Error).message}`);
  } finally {
    transport.close();
  }
}

// A thread ID holds the mailbox path and the message UID.
const encodeThreadId = (path: string, uid: number) =>
  `${Buffer.from(path).toString("base64url")}.${uid}`;

function decodeThreadId(id: string) {
  const [path, uid] = id.split(".");
  const parsedUid = Number(uid);
  if (!path || !Number.isInteger(parsedUid)) throw new ProviderError("Invalid message ID", 400);
  return { path: Buffer.from(path, "base64url").toString("utf8"), uid: parsedUid };
}

const fromEnvelope = (list?: MessageAddressObject[]): Address[] =>
  (list ?? [])
    .filter((a) => a.address)
    .map((a) => ({ name: a.name || undefined, email: a.address! }));

export const fromParsed = (value?: AddressObject | AddressObject[]): Address[] =>
  (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((group) => group.value)
    .filter((a) => a.address)
    .map((a) => ({ name: a.name || undefined, email: a.address! }));

/** The unparsed value of a header. mailparser changes List-* headers into objects. */
function rawHeader(parsed: ParsedMail, name: string) {
  const line = parsed.headerLines.find((h) => h.key === name)?.line;
  return line?.slice(line.indexOf(":") + 1).trim();
}

/** Makes the app's message from a parsed RFC 5322 message. Attachment IDs are the attachment indexes. */
export function messageFromParsed(
  parsed: ParsedMail,
  state: { id: string; threadId: string; unread: boolean; starred: boolean },
): Message {
  const text = parsed.text ?? undefined;
  return {
    ...state,
    from: fromParsed(parsed.from)[0] ?? { email: "unknown" },
    to: fromParsed(parsed.to),
    cc: fromParsed(parsed.cc),
    bcc: fromParsed(parsed.bcc),
    replyTo: fromParsed(parsed.replyTo),
    subject: parsed.subject || "(no subject)",
    date: (parsed.date ?? new Date()).toISOString(),
    snippet: snippetFromText(text),
    html: parsed.html || undefined,
    text,
    attachments: parsed.attachments.map((attachment, index) => ({
      id: String(index),
      filename: attachment.filename || "attachment",
      mimeType: attachment.contentType,
      size: attachment.size,
      contentId: attachment.contentId?.replace(/^<|>$/g, ""),
      inline: attachment.contentDisposition === "inline" || attachment.related === true,
    })),
    messageIdHeader: parsed.messageId,
    references: Array.isArray(parsed.references)
      ? parsed.references
      : parsed.references
        ? [parsed.references]
        : undefined,
    unsubscribe: parseListUnsubscribe(
      rawHeader(parsed, "list-unsubscribe"),
      rawHeader(parsed, "list-unsubscribe-post"),
    ),
  };
}

function hasAttachment(structure: FetchMessageObject["bodyStructure"]): boolean {
  if (!structure) return false;
  if (structure.disposition === "attachment") return true;
  return structure.childNodes?.some(hasAttachment) ?? false;
}

export function createImapProvider(account: Account): MailProvider {
  const credentials = account.credentials as ImapCredentials;

  async function client() {
    const entry = connection(account);
    await entry.ready;
    return entry;
  }

  async function withMailbox<T>(path: string, fn: (client: ImapFlow) => Promise<T>) {
    const { client: imap } = await client();
    const lock = await imap.getMailboxLock(path);
    try {
      return await fn(imap);
    } finally {
      lock.release();
    }
  }

  async function mailboxes() {
    const entry = await client();
    entry.mailboxes ??= entry.client.list();
    return entry.mailboxes;
  }

  async function folderPath(folder: Folder, create = false): Promise<string | undefined> {
    if (folder === "inbox") return "INBOX";
    const list = await mailboxes();
    const found =
      list.find((box) => box.specialUse && SPECIAL_USE[folder].includes(box.specialUse)) ??
      list.find((box) => NAME_FALLBACK[folder].test(box.name));
    if (found) return found.path;
    if (!create || folder === "starred") return undefined;
    const name = folder[0].toUpperCase() + folder.slice(1);
    const { client: imap } = await client();
    const created = await imap.mailboxCreate(name);
    (await client()).mailboxes = undefined;
    return created.path;
  }

  function summarize(path: string, message: FetchMessageObject, folder: Folder): ThreadSummary {
    const envelope = message.envelope;
    const people =
      folder === "sent" || folder === "drafts"
        ? fromEnvelope(envelope?.to)
        : fromEnvelope(envelope?.from);
    return {
      accountId: account.id,
      id: encodeThreadId(path, message.uid),
      subject: envelope?.subject || "(no subject)",
      snippet: "",
      participants: people,
      date: new Date(envelope?.date ?? message.internalDate ?? Date.now()).toISOString(),
      unread: !message.flags?.has("\\Seen"),
      starred: !!message.flags?.has("\\Flagged"),
      messageCount: 1,
      hasAttachments: hasAttachment(message.bodyStructure),
      messageIds: envelope?.messageId ? [envelope.messageId] : [],
    };
  }

  async function parseMessage(threadId: string) {
    const { path, uid } = decodeThreadId(threadId);
    return withMailbox(path, async (imap) => {
      const message = await imap.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
      if (!message || !message.source) throw new ProviderError("Message not found", 404);
      return { message, parsed: await simpleParser(message.source) };
    });
  }

  async function move(threadId: string, folder: Folder) {
    const { path, uid } = decodeThreadId(threadId);
    const destination = await folderPath(folder, true);
    if (!destination || destination === path) return {};
    return withMailbox(path, async (imap) => {
      const result = await imap.messageMove(String(uid), destination, { uid: true });
      const newUid = result && result.uidMap?.get(uid);
      return newUid ? { threadId: encodeThreadId(destination, newUid) } : {};
    });
  }

  async function setFlag(threadId: string, flag: string, on: boolean) {
    const { path, uid } = decodeThreadId(threadId);
    await withMailbox(path, (imap) =>
      on
        ? imap.messageFlagsAdd(String(uid), [flag], { uid: true })
        : imap.messageFlagsRemove(String(uid), [flag], { uid: true }),
    );
  }

  return {
    async listThreads({ folder, query, cursor, limit }: ListOptions): Promise<ThreadPage> {
      const flaggedFolder = folder === "starred" ? await folderPath("starred") : undefined;
      const path = folder === "starred" ? (flaggedFolder ?? "INBOX") : await folderPath(folder);
      if (!path) return { threads: [] };

      return withMailbox(path, async (imap) => {
        const criteria: Record<string, unknown> = {};
        if (folder === "starred" && !flaggedFolder) criteria.flagged = true;
        if (query) criteria.or = [{ subject: query }, { from: query }, { body: query }];
        const uids =
          Object.keys(criteria).length > 0
            ? (await imap.search(criteria, { uid: true })) || []
            : (await imap.search({ all: true }, { uid: true })) || [];

        const offset = Number(cursor) || 0;
        const pageUids = uids.sort((a, b) => b - a).slice(offset, offset + limit);
        if (pageUids.length === 0) return { threads: [] };

        const threads: ThreadSummary[] = [];
        for await (const message of imap.fetch(
          pageUids.join(","),
          { envelope: true, flags: true, bodyStructure: true, internalDate: true },
          { uid: true },
        )) {
          threads.push(summarize(path, message, folder));
        }
        threads.sort((a, b) => b.date.localeCompare(a.date));
        const next = offset + limit;
        return { threads, nextCursor: next < uids.length ? String(next) : undefined };
      });
    },

    async getThread(threadId: string): Promise<Thread> {
      const { message, parsed } = await parseMessage(threadId);
      const result = messageFromParsed(parsed, {
        id: threadId,
        threadId,
        unread: !message.flags?.has("\\Seen"),
        starred: !!message.flags?.has("\\Flagged"),
      });
      return {
        accountId: account.id,
        id: threadId,
        subject: result.subject,
        messages: [result],
        starred: result.starred,
        unread: result.unread,
      };
    },

    async modifyThread(threadId: string, action: ThreadAction) {
      switch (action) {
        case "archive":
          return move(threadId, "archive");
        case "inbox":
          return move(threadId, "inbox");
        case "trash":
          return move(threadId, "trash");
        case "spam":
          return move(threadId, "spam");
        case "star":
          return setFlag(threadId, "\\Flagged", true);
        case "unstar":
          return setFlag(threadId, "\\Flagged", false);
        case "read":
          return setFlag(threadId, "\\Seen", true);
        case "unread":
          return setFlag(threadId, "\\Seen", false);
      }
    },

    async send(message: OutgoingMessage) {
      const from = { name: account.name, email: account.email };
      const transport = nodemailer.createTransport({
        host: credentials.smtp.host,
        port: credentials.smtp.port,
        secure: credentials.smtp.secure,
        auth: { user: credentials.user, pass: credentials.password },
      });
      try {
        await transport.sendMail({
          envelope: {
            from: account.email,
            to: [...message.to, ...message.cc, ...message.bcc].map((a) => a.email),
          },
          raw: await buildMime(from, message, { keepBcc: false }),
        });
      } catch (error) {
        if ((error as { responseCode?: number }).responseCode === 535) {
          await setAccountStatus(account.id, "reauth_required");
          throw new ProviderAuthError("The SMTP server rejected the password");
        }
        throw error;
      } finally {
        transport.close();
      }

      if (!AUTO_SAVES_SENT.test(credentials.smtp.host)) {
        const sent = await folderPath("sent", true);
        if (sent) {
          const { client: imap } = await client();
          await imap.append(sent, await buildMime(from, message, { keepBcc: true }), ["\\Seen"]);
        }
      }
    },

    async getAttachment(messageId: string, attachmentId: string) {
      const { parsed } = await parseMessage(messageId);
      const attachment = parsed.attachments[Number(attachmentId)];
      if (!attachment) throw new ProviderError("Attachment not found", 404);
      return {
        filename: attachment.filename || "attachment",
        mimeType: attachment.contentType,
        data: attachment.content,
      };
    },

    async inboxUnreadCount() {
      const { client: imap } = await client();
      const status = await imap.status("INBOX", { unseen: true });
      return (status && status.unseen) || 0;
    },
  };
}
