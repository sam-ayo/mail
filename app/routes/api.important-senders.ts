import { importantSenderPattern, type Folder, type KnownSender } from "~/lib/mail";
import { listAccounts } from "~/server/accounts.server";
import { requireUserId } from "~/server/auth.server";
import { query } from "~/server/db.server";
import { listThreads } from "~/server/mail.server";
import { addImportantSender, setCategories, type CategoryInput } from "~/server/triage.server";
import type { Route } from "./+types/api.important-senders";

// The list of important senders. GET gives the senders that the field in
// Settings suggests. POST adds a sender from a conversation. The conversations
// in the request also move to Important, because a demo mailbox has categories
// that the database does not have.

/** The most senders that the field can suggest. */
const KNOWN_MAX = 1000;
/** The folders that give the senders. Sent gives the people that the person writes to. */
const LIST_FOLDERS: Folder[] = ["inbox", "archive", "sent"];
const SEARCH_FOLDERS: Folder[] = ["inbox", "archive"];

/**
 * The people in the person's mail, for the suggestions of the field in
 * Settings. With no "q", the people in the first page of Inbox, Archive, and
 * Sent of each account, and the senders of sorted conversations. The browser
 * loads this list once and filters it as the person types. With "q", the
 * people in the conversations that a mail search for the text finds, so
 * older mail gives suggestions too.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const text = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const accounts = await listAccounts(userId);
  const own = new Set(accounts.map((a) => a.email.toLowerCase()));
  const folders = text ? SEARCH_FOLDERS : LIST_FOLDERS;
  const [sorted, ...pages] = await Promise.all([
    text
      ? []
      : query<{ sender: string; count: string }>(
          `SELECT c.sender, count(*) AS count FROM thread_categories c JOIN accounts a ON a.id = c.account_id
           WHERE a.user_id = $1 AND c.sender LIKE '%@%'
           GROUP BY c.sender ORDER BY count(*) DESC LIMIT $2`,
          [userId, KNOWN_MAX],
        ),
    // A mail server error leaves the other folders.
    ...folders.map((folder) =>
      listThreads(userId, { scope: "all", folder, query: text || undefined, cursor: null }, accounts).catch(
        () => undefined,
      ),
    ),
  ]);
  // Each conversation counts once for each person in it.
  const counts = new Map<string, number>();
  for (const thread of pages.flatMap((page) => page?.threads ?? [])) {
    for (const address of new Set(thread.participants.map((p) => p.email.toLowerCase()))) {
      // The list of important senders needs a full address.
      if (!own.has(address) && importantSenderPattern(address) === address) {
        counts.set(address, (counts.get(address) ?? 0) + 1);
      }
    }
  }
  for (const row of sorted) counts.set(row.sender, Math.max(counts.get(row.sender) ?? 0, Number(row.count)));
  const senders: KnownSender[] = [...counts]
    .map(([email, count]) => ({ email, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, KNOWN_MAX);
  return Response.json({ senders });
}

interface Body {
  sender: unknown;
  targets?: { accountId: string; threadId: string; sender?: string }[];
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const body = (await request.json().catch(() => null)) as Body | null;
  const targets = body?.targets ?? [];
  if (!body || typeof body.sender !== "string" || !Array.isArray(targets) || targets.length > 500) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const pattern = await addImportantSender(userId, body.sender);
  if (!pattern) return Response.json({ error: "Not an address or a domain" }, { status: 400 });
  const items = targets.map((t) => ({
    accountId: String(t.accountId),
    threadId: String(t.threadId),
    category: "important",
    sender: t.sender,
  })) as CategoryInput[];
  await setCategories(userId, items, "user");
  return Response.json({ pattern });
}
