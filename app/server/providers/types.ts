import type { Address, Folder, Thread, ThreadAction, ThreadSummary } from "~/lib/mail";

export interface ListOptions {
  folder: Folder;
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
  send(message: OutgoingMessage): Promise<void>;
  getAttachment(messageId: string, attachmentId: string): Promise<AttachmentContent>;
  /** Unread conversations in the inbox. */
  inboxUnreadCount(): Promise<number>;
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
