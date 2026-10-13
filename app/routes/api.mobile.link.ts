import { requireUserId } from "~/server/auth.server";
import { createLinkTicket } from "~/server/mobile.server";
import type { Route } from "./+types/api.mobile.link";

/** Gives the signed-in app a ticket, so that a new account joins the same user. */
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  return Response.json({ ticket: createLinkTicket(userId) }, { headers: { "Cache-Control": "no-store" } });
}
