import { ACCOUNT_COLORS } from "~/lib/mail";
import { deleteAccount, getAccount, toSummary, updateAccountProfile } from "~/server/accounts.server";
import { requireUserId } from "~/server/auth.server";
import { resetDemoAccount } from "~/server/providers/demo.server";
import { closeImapConnection } from "~/server/providers/imap.server";
import type { Route } from "./+types/api.v1.account";

/** PATCH changes the name or color of an account. DELETE removes the account. */
export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const account = await getAccount(userId, params.accountId);
  if (!account) return Response.json({ error: "Account not found" }, { status: 404 });

  switch (request.method) {
    case "PATCH": {
      const body = (await request.json().catch(() => ({}))) as { name?: unknown; color?: unknown };
      await updateAccountProfile(userId, account.id, {
        name: typeof body.name === "string" ? body.name.trim() : undefined,
        color: typeof body.color === "string" && ACCOUNT_COLORS.includes(body.color) ? body.color : undefined,
      });
      return Response.json({ account: toSummary((await getAccount(userId, account.id))!) });
    }
    case "DELETE":
      await deleteAccount(userId, account.id);
      closeImapConnection(account.id);
      resetDemoAccount(account.id);
      return new Response(null, { status: 204 });
    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
