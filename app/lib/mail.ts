// Types and helpers that the server and the browser share.

export type ProviderKind = "google" | "microsoft" | "imap" | "hosted" | "demo";

export type AccountStatus = "active" | "reauth_required";

export interface AccountSummary {
  id: string;
  provider: ProviderKind;
  email: string;
  name: string;
  color: string;
  status: AccountStatus;
  /** The provider that the app shows. A demo account can look like a Gmail or a custom domain account. */
  look?: ProviderKind;
}

/** The provider to show for an account. */
export function shownProvider(account: { provider: ProviderKind; look?: ProviderKind }) {
  return account.look ?? account.provider;
}

export const FOLDERS = [
  "inbox",
  "starred",
  "sent",
  "drafts",
  "archive",
  "spam",
  "trash",
] as const;

export type Folder = (typeof FOLDERS)[number];

export const FOLDER_LABELS: Record<Folder, string> = {
  inbox: "Inbox",
  starred: "Starred",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
  spam: "Spam",
  trash: "Trash",
};

export function isFolder(value: string | undefined): value is Folder {
  return !!value && (FOLDERS as readonly string[]).includes(value);
}

export interface Address {
  name?: string;
  email: string;
}

export interface ThreadSummary {
  accountId: string;
  id: string;
  subject: string;
  snippet: string;
  participants: Address[];
  date: string; // ISO 8601
  unread: boolean;
  starred: boolean;
  messageCount: number;
  hasAttachments: boolean;
  /** RFC 5322 Message-ID headers of the messages in the conversation, if the provider has them. */
  messageIds?: string[];
  /** The same conversation in other accounts. `mergeDuplicates` sets this. */
  copies?: { accountId: string; id: string }[];
  /** The category from AI sorting, or from the person. Only inbox lists have it. */
  category?: ThreadCategory;
}

/** The categories of AI sorting. A conversation with no category shows with the important mail. */
export const THREAD_CATEGORIES = ["important", "promotion"] as const;

export type ThreadCategory = (typeof THREAD_CATEGORIES)[number];

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  inline: boolean;
}

export interface Message {
  id: string;
  threadId: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  subject: string;
  date: string;
  snippet: string;
  html?: string;
  text?: string;
  unread: boolean;
  starred: boolean;
  attachments: Attachment[];
  messageIdHeader?: string;
  references?: string[];
  /** Set if the message is from a mailing list that has a List-Unsubscribe header. */
  unsubscribe?: Unsubscribe;
}

/** The ways to leave a mailing list, from the List-Unsubscribe header (RFC 2369). */
export interface Unsubscribe {
  /** An HTTPS address. */
  url?: string;
  /** A `mailto:` address. */
  mailto?: string;
  /** The sender accepts a POST to `url` with no other step (RFC 8058). */
  oneClick: boolean;
}

/** The method that the app uses to unsubscribe. Only "website" needs the person to leave the app. */
export function unsubscribeMethod(unsubscribe: Unsubscribe): "oneClick" | "email" | "website" | null {
  if (unsubscribe.url && unsubscribe.oneClick) return "oneClick";
  if (unsubscribe.mailto) return "email";
  if (unsubscribe.url) return "website";
  return null;
}

export interface Thread {
  accountId: string;
  id: string;
  subject: string;
  messages: Message[];
  starred: boolean;
  unread: boolean;
}

export type ThreadAction =
  | "archive"
  | "inbox"
  | "trash"
  | "spam"
  | "star"
  | "unstar"
  | "read"
  | "unread";

export const THREAD_ACTIONS: readonly ThreadAction[] = [
  "archive",
  "inbox",
  "trash",
  "spam",
  "star",
  "unstar",
  "read",
  "unread",
];

/** Actions that take the thread out of the current folder view. */
export function removesFromFolder(action: ThreadAction, folder: Folder) {
  switch (action) {
    case "archive":
      return folder !== "archive";
    case "trash":
      return folder !== "trash";
    case "spam":
      return folder !== "spam";
    case "inbox":
      return folder !== "inbox";
    case "unstar":
      return folder === "starred";
    default:
      return false;
  }
}

export function threadKey(accountId: string, threadId: string) {
  return `${accountId}:${threadId}`;
}

/** The conversation and its copies in other accounts. Actions go to all of them. */
export function threadRefs(thread: ThreadSummary) {
  return [thread, ...(thread.copies ?? [])].map((t) => ({ accountId: t.accountId, threadId: t.id }));
}

/**
 * Shows a conversation one time when it is in two or more accounts, for example
 * a message to your Gmail and Outlook addresses. Two conversations are the same
 * if they have a Message-ID in common. The newest copy keeps its place in the list.
 */
export function mergeDuplicates(threads: ThreadSummary[]): ThreadSummary[] {
  const owner = new Map<string, number>();
  const parent = threads.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  threads.forEach((thread, i) => {
    for (const id of thread.messageIds ?? []) {
      const first = owner.get(id);
      if (first === undefined) owner.set(id, i);
      // Copies in one account are separate conversations there, so do not merge them.
      else if (threads[first].accountId !== thread.accountId) {
        const [a, b] = [root(first), root(i)];
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  });

  const groups = new Map<number, ThreadSummary[]>();
  threads.forEach((thread, i) => {
    const group = groups.get(root(i)) ?? [];
    group.push(thread);
    groups.set(root(i), group);
  });

  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const [primary, ...copies] = [...group].sort((a, b) => b.date.localeCompare(a.date));
    return {
      ...primary,
      unread: group.some((t) => t.unread),
      starred: group.some((t) => t.starred),
      hasAttachments: group.some((t) => t.hasAttachments),
      copies: copies.map((t) => ({ accountId: t.accountId, id: t.id })),
    };
  });
}

export function formatAddress(address: Address) {
  return address.name ? `${address.name} <${address.email}>` : address.email;
}

export function displayName(address: Address) {
  return address.name || address.email.split("@")[0];
}

export function parseAddressList(input: string): Address[] {
  return input
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*)<([^>]+)>$/);
      if (match) {
        const name = match[1].trim().replace(/^"|"$/g, "");
        return { name: name || undefined, email: match[2].trim() };
      }
      return { email: part };
    });
}

export function formatListDate(iso: string, now = new Date()) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

export function formatFullDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const ACCOUNT_COLORS = [
  "#6366f1",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#0ea5e9",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
];

/** Returns the text color with the higher contrast on a hex background color. */
export function textOn(background: string) {
  const channel = (offset: number) => {
    const value = parseInt(background.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  // White has a luminance of 1. Zinc 900 (#18181b) has a luminance of about 0.01.
  return (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.06) ? "#ffffff" : "#18181b";
}

/** A message as the reading pane gets it. `html` is a full, sanitized document. */
export interface RenderedMessage extends Omit<Message, "html"> {
  html?: string;
  hasQuote: boolean;
}

export interface RenderedThread extends Omit<Thread, "messages"> {
  messages: RenderedMessage[];
}

export interface AccountError {
  accountId: string;
  email: string;
  message: string;
  reauth: boolean;
}

/** The thread list adds this search parameter to the URLs that it loads early. */
export const PREFETCH_PARAM = "prefetch";

export function attachmentUrl(
  accountId: string,
  messageId: string,
  attachmentId: string,
  download = false,
) {
  const params = new URLSearchParams({ m: messageId, a: attachmentId });
  if (download) params.set("download", "1");
  return `/api/attachments/${accountId}?${params}`;
}

const countFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** "7", "1,284" shows as "1.3K". Counts never need more precision in a badge. */
export function formatCount(value: number) {
  return value < 1000 ? String(value) : countFormat.format(value);
}

/**
 * Makes a pattern for the list of important senders from text that the person
 * typed: a full address, or a domain with or without "@". Other text gives undefined.
 */
export function importantSenderPattern(text: string) {
  const value = text.trim().toLowerCase().replace(/^mailto:/, "");
  const domain = /^@?([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(value)?.[1];
  if (domain) return value.length <= 254 ? `@${domain}` : undefined;
  return /^[^\s@<>()",;]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value) && value.length <= 320 ? value : undefined;
}

/** The pattern matches the address. A domain pattern also matches its subdomains. */
export function senderMatches(pattern: string, sender: string) {
  if (!pattern.startsWith("@")) return sender === pattern;
  return sender.endsWith(pattern) || sender.endsWith(`.${pattern.slice(1)}`);
}

/** A sender from the person's mail, with the number of conversations from it. */
export interface KnownSender {
  email: string;
  count: number;
}

/**
 * Suggestions for the list of important senders: addresses and domains from
 * the person's mail that contain the text. Ones that start with the text come
 * first, then the ones with more conversations. Text that starts with "@" gives
 * only domains. Senders that the list already matches do not show. A full
 * address or domain in the text also shows, so the person can pick it.
 */
export function suggestImportantSenders(known: KnownSender[], listed: string[], text: string, limit = 8) {
  const value = text.trim().toLowerCase();
  const term = value.replace(/^@/, "");
  if (!term) return [];
  const counts = new Map<string, number>();
  for (const { email, count } of known) {
    if (listed.some((pattern) => senderMatches(pattern, email))) continue;
    if (!value.startsWith("@")) counts.set(email, (counts.get(email) ?? 0) + count);
    const domain = `@${email.split("@").pop()}`;
    counts.set(domain, (counts.get(domain) ?? 0) + count);
  }
  const starts = (pattern: string) => pattern.startsWith(term) || pattern.startsWith(`@${term}`);
  const shown = [...counts]
    .filter(([pattern]) => pattern.includes(term))
    .sort(
      ([a, countA], [b, countB]) =>
        Number(starts(b)) - Number(starts(a)) || countB - countA || a.localeCompare(b),
    )
    .map(([pattern]) => pattern)
    .slice(0, limit);
  // The typed text comes last while a suggestion starts with it, because the person can still type.
  const typed = importantSenderPattern(text);
  if (!typed || listed.includes(typed) || shown.includes(typed)) return shown;
  return shown.some((s) => s.startsWith(typed))
    ? [...shown.slice(0, limit - 1), typed]
    : [typed, ...shown.slice(0, limit - 1)];
}
