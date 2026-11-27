import type { Contact, Folder } from "~/lib/mail";
import { listAccounts } from "./accounts.server";
import { listThreads } from "./mail.server";

/** The most people that the list can have. */
const MAX = 1000;
/** The person wrote to the people in Sent. Thus a conversation in Sent counts more. */
const WEIGHTS: Partial<Record<Folder, number>> = { sent: 3, inbox: 1, archive: 1 };
const FOLDERS: Folder[] = ["sent", "inbox", "archive"];

/**
 * The people in the person's mail, most frequent first. With no text, the
 * people in the first page of Sent, Inbox, and Archive of each account. With
 * text, the people in the conversations that a mail search for the text finds,
 * so older mail gives people too. The person's own addresses are not in it.
 */
export async function listContacts(userId: string, text = ""): Promise<Contact[]> {
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
  return [...people]
    .map(([email, { count, names }]) => {
      const name = [...names].sort((a, b) => b[1] - a[1])[0]?.[0];
      return name ? { email, name, count } : { email, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX);
}

/**
 * The people whose name or address has each word of the text, most frequent
 * first. It looks in the recent people and in the people of the conversations
 * that a mail search finds. Thus a person is found also when the search of a
 * mail server does not look at names or recipients.
 */
export async function findContacts(userId: string, text: string) {
  const [recent, searched] = await Promise.all([listContacts(userId), listContacts(userId, text)]);
  const people = new Map<string, Contact>();
  for (const contact of [...recent, ...searched]) {
    const known = people.get(contact.email);
    people.set(contact.email, {
      email: contact.email,
      ...((known?.name ?? contact.name) && { name: known?.name ?? contact.name }),
      count: Math.max(known?.count ?? 0, contact.count),
    });
  }
  return matchContacts([...people.values()], text).sort((a, b) => b.count - a.count);
}

/**
 * The contacts whose name or address has each word of the text. A search finds
 * conversations, and the other people in them do not match the text, so they
 * are not in the result.
 */
export function matchContacts(contacts: Contact[], text: string) {
  const words = text.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return contacts.filter((contact) => {
    const haystack = `${contact.name ?? ""} ${contact.email}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
