import type { Address, MailboxFolder, Thread, ThreadAction, ThreadCategory, ThreadSummary } from "~/lib/mail";

export interface ListOptions {
  folder: MailboxFolder;
  /** List only the conversations that have unread mail. */
  unread?: boolean;
  query?: string;
  cursor?: string;
  limit: number;
}

export interface ThreadPage {
  threads: ThreadSummary[];
  nextCursor?: string;
}

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface OutgoingMessage {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  text: string;
  html: string;
  attachments: OutgoingAttachment[];
  /** Set for replies and forwards, so the provider can keep the thread. */
  reply?: {
    kind: "reply" | "forward";
    threadId: string;
    messageId: string;
    messageIdHeader?: string;
    references?: string[];
  };
}

export interface UnreadInbox {
  /** Unread items in the inbox. */
  total: number;
  /**
   * The conversation of each unread item that `total` counts, at most the
   * limit. A conversation with more than one unread item shows more than once.
   */
  threads: { id: string; category?: ThreadCategory }[];
}

export interface AttachmentContent {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface MailProvider {
  listThreads(options: ListOptions): Promise<ThreadPage>;
  getThread(threadId: string): Promise<Thread>;
  /**
   * Returns the new thread ID if the action changed it. IMAP moves change the
   * message UID, so an undo needs the new ID.
   */
  modifyThread(threadId: string, action: ThreadAction): Promise<{ threadId?: string } | void>;
  /** With a draft ID, the provider also removes that draft from the mail server. */
  send(message: OutgoingMessage, options?: { draftId?: string }): Promise<void>;
  /**
   * Saves the message as a draft on the mail server. With a draft ID, the
   * message replaces that draft. The ID can change with each save, so the
   * caller must keep the ID from the answer. Attachments are not saved.
   * A provider with no Drafts folder does not have this method.
   */
  saveDraft?(message: OutgoingMessage, draftId?: string): Promise<{ draftId: string }>;
  /** Deletes a draft. A draft that does not exist is not an error. */
  deleteDraft?(draftId: string): Promise<void>;
  getAttachment(messageId: string, attachmentId: string): Promise<AttachmentContent>;
  /** The unread items in the inbox, with their conversations. */
  inboxUnread(limit: number): Promise<UnreadInbox>;
}

/** The provider rejected the credentials. The person must sign in again. */
export class ProviderAuthError extends Error {
  constructor(message = "The account needs you to sign in again") {
    super(message);
    this.name = "ProviderAuthError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
