import type { ThreadCategory, ThreadSummary } from "~/lib/mail";
import { THREAD_CATEGORIES, threadKey } from "~/lib/mail";
import type { Account } from "./accounts.server";
import { listAccounts } from "./accounts.server";
import { query } from "./db.server";
import { providerFor } from "./mail.server";
import { htmlToText } from "./sanitize.server";
import { errorMessage, mapLimit } from "./util.server";

// AI sorting of the inbox. A script on the person's computer gets the new
// inbox conversations from /api/triage, sorts them with Claude Code or Codex,
// and sends the categories back. The server does not call an AI model.

/** The text of each conversation that the AI reads. Short text keeps each run cheap. */
const BODY_CHARS = 1200;
/** The newest inbox conversations of each account that the sort looks at. */
const INBOX_PAGE = 30;

export function isThreadCategory(value: unknown): value is ThreadCategory {
  return (THREAD_CATEGORIES as readonly unknown[]).includes(value);
}

/** The categories of the given conversations, by thread key. */
export async function categoriesFor(threads: Pick<ThreadSummary, "accountId" | "id">[]) {
  const categories = new Map<string, ThreadCategory>();
  if (threads.length === 0) return categories;
  const rows = await query<{ account_id: string; thread_id: string; category: ThreadCategory }>(
    `SELECT account_id, thread_id, category FROM thread_categories
     WHERE (account_id, thread_id) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
    [threads.map((t) => t.accountId), threads.map((t) => t.id)],
  );
  for (const row of rows) categories.set(threadKey(row.account_id, row.thread_id), row.category);
  return categories;
}

/** Adds the category to each conversation that has one. A database error leaves the list unsorted. */
export async function withCategories(threads: ThreadSummary[]) {
  const categories = await categoriesFor(threads).catch((error) => {
    console.error("Cannot read the thread categories", error);
    return new Map<string, ThreadCategory>();
  });
  return threads.map((thread) => {
    const category = categories.get(threadKey(thread.accountId, thread.id));
    return category ? { ...thread, category } : thread;
  });
}

export interface CategoryInput {
  accountId: string;
  threadId: string;
  category: ThreadCategory;
  sender?: string;
}

/**
 * Saves categories for conversations in the person's accounts. Other items are
 * ignored. An AI result does not replace a category that the person set.
 */
export async function setCategories(userId: string, items: CategoryInput[], source: "ai" | "user") {
  const accountIds = new Set((await listAccounts(userId)).map((a) => a.id));
  const valid = items.filter(
    (item) =>
      accountIds.has(item.accountId) &&
      typeof item.threadId === "string" &&
      item.threadId.length > 0 &&
      item.threadId.length <= 512 &&
      isThreadCategory(item.category),
  );
  if (valid.length === 0) return 0;
  await query(
    `INSERT INTO thread_categories (account_id, thread_id, category, source, sender)
     SELECT account_id, thread_id, category, $5, sender
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS t(account_id, thread_id, category, sender)
     ON CONFLICT (account_id, thread_id) DO UPDATE
       SET category = EXCLUDED.category, source = EXCLUDED.source, sender = EXCLUDED.sender, updated_at = now()
       WHERE thread_categories.source = 'ai' OR EXCLUDED.source = 'user'`,
    [
      valid.map((item) => item.accountId),
      valid.map((item) => item.threadId),
      valid.map((item) => item.category),
      valid.map((item) => String(item.sender ?? "").toLowerCase().slice(0, 320)),
      source,
    ],
  );
  return valid.length;
}

/** A conversation for the AI to sort. Email content comes from other people. */
export interface TriageThread {
  account_id: string;
  thread_id: string;
  /** The address that got the email. */
  account_email: string;
  from: string;
  subject: string;
  date: string;
  message_count: number;
  /** The person sent a message in the conversation. */
  you_replied: boolean;
  /** The sender is a mailing list (List-Unsubscribe header). */
  mailing_list: boolean;
  body: string;
}

/** Senders that the person moved, newest first. The AI uses them as examples. */
async function userExamples(userId: string) {
  return query<{ sender: string; category: ThreadCategory }>(
    `SELECT DISTINCT ON (c.sender) c.sender, c.category
     FROM thread_categories c JOIN accounts a ON a.id = c.account_id
     WHERE a.user_id = $1 AND c.source = 'user' AND c.sender <> ''
     ORDER BY c.sender, c.updated_at DESC
     LIMIT 100`,
    [userId],
  );
}

async function describe(account: Account, summary: ThreadSummary): Promise<TriageThread> {
  const sender = summary.participants[0];
  const base: TriageThread = {
    account_id: account.id,
    thread_id: summary.id,
    account_email: account.email,
    from: sender ? (sender.name ? `${sender.name} <${sender.email}>` : sender.email) : "",
    subject: summary.subject,
    date: summary.date,
    message_count: summary.messageCount,
    you_replied: false,
    mailing_list: false,
    body: summary.snippet,
  };
  try {
    const thread = await providerFor(account).getThread(summary.id);
    const own = account.email.toLowerCase();
    const theirs = thread.messages.filter((m) => m.from.email.toLowerCase() !== own);
    const latest = theirs.at(-1) ?? thread.messages.at(-1);
    if (!latest) return base;
    const text = latest.text?.trim() || (latest.html ? htmlToText(latest.html) : latest.snippet);
    return {
      ...base,
      you_replied: theirs.length < thread.messages.length,
      mailing_list: thread.messages.some((m) => m.unsubscribe),
      body: text.replace(/\s+/g, " ").slice(0, BODY_CHARS),
    };
  } catch {
    // The list data is enough to sort most mail.
    return base;
  }
}

/**
 * The newest inbox conversations that have no category, at most `limit`, and
 * the examples from the person's own changes.
 */
export async function unsortedThreads(userId: string, limit: number) {
  const accounts = (await listAccounts(userId)).filter((a) => a.status === "active");
  const errors: { account_email: string; message: string }[] = [];
  const pages = await Promise.all(
    accounts.map(async (account) => {
      try {
        const page = await providerFor(account).listThreads({ folder: "inbox", limit: INBOX_PAGE });
        return page.threads.map((thread) => ({ account, thread }));
      } catch (error) {
        errors.push({ account_email: account.email, message: errorMessage(error) });
        return [];
      }
    }),
  );
  const all = pages.flat();
  const categories = await categoriesFor(all.map((item) => item.thread));
  const todo = all
    .filter((item) => !categories.has(threadKey(item.thread.accountId, item.thread.id)))
    .sort((a, b) => b.thread.date.localeCompare(a.thread.date))
    .slice(0, limit);
  const [threads, examples] = await Promise.all([
    mapLimit(todo, 4, (item) => describe(item.account, item.thread)),
    userExamples(userId),
  ]);
  return { threads, examples, errors };
}
