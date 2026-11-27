import { requireUserId } from "~/server/auth.server";
import { listContacts } from "~/server/contacts.server";
import type { Route } from "./+types/api.contacts";

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
  const contacts = await listContacts(userId, text);
  return Response.json({ contacts }, { headers: { "Cache-Control": "private, no-store" } });
}
