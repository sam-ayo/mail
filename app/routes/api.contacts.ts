import type { Contact, Folder } from "~/lib/mail";
import { listAccounts } from "~/server/accounts.server";
import { requireUserId } from "~/server/auth.server";
import { listThreads } from "~/server/mail.server";
import type { Route } from "./+types/api.contacts";

/** The most people that the response can have. */
const MAX = 1000;
/** The person wrote to the people in Sent. Thus a conversation in Sent counts more. */
const WEIGHTS: Partial<Record<Folder, number>> = { sent: 3, inbox: 1, archive: 1 };
const FOLDERS: Folder[] = ["sent", "inbox", "archive"];

/**
 * The people in the person's mail, for the suggestions of the recipient fields
 * in the composer. With no "q", the people in the first page of Sent, Inbox,
 * and Archive of each account. The browser loads this list once and filters it
 * as the person types. With "q", the people in the conversations that a mail
 * search for the text finds, so older mail gives suggestions too.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const text = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const accounts = await listAccounts(userId);
  const own = new Set(accounts.map((a) => a.email.toLowerCase()));
  const pages = await Promise.all(
    // A mail server error leaves the other folders.
    FOLDERS.map((folder) =>
      listThreads(userId, { scope: "all", folder, query: text || undefined, cursor: null }, accounts)
        .then((page) => ({ folder, threads: page.threads }))
        .catch(() => ({ folder, threads: [] })),
    ),
  );

  // Each conversation counts once for each person in it. The name that shows
  // most often is the name of the person.
  const people = new Map<string, { count: number; names: Map<string, number> }>();
  for (const { folder, threads } of pages) {
    const weight = WEIGHTS[folder] ?? 1;
    for (const thread of threads) {
      const seen = new Set<string>();
      for (const participant of thread.participants) {
        const email = participant.email.trim().toLowerCase();
        if (!email.includes("@") || own.has(email) || /^(no-?reply|do-?not-?reply|mailer-daemon)@/.test(email)) {
          continue;
        }
        const person = people.get(email) ?? { count: 0, names: new Map() };
        if (!seen.has(email)) person.count += weight;
        seen.add(email);
        const name = participant.name?.trim();
        if (name && name.toLowerCase() !== email) person.names.set(name, (person.names.get(name) ?? 0) + 1);
        people.set(email, person);
      }
    }
  }
  const contacts: Contact[] = [...people]
    .map(([email, { count, names }]) => {
      const name = [...names].sort((a, b) => b[1] - a[1])[0]?.[0];
      return name ? { email, name, count } : { email, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX);
  return Response.json({ contacts }, { headers: { "Cache-Control": "private, no-store" } });
}
