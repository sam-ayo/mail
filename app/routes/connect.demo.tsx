import { redirect } from "react-router";
import { listAccounts, userExists } from "~/server/accounts.server";
import { connectAccount } from "~/server/auth.server";
import { randomToken } from "~/server/crypto.server";
import { DEMO_PERSONAS } from "~/server/providers/demo.server";
import { getSession } from "~/server/session.server";
import type { Route } from "./+types/connect.demo";

export const loader = () => redirect("/welcome");

export async function action({ request }: Route.ActionArgs) {
  // Development only. Production users connect real accounts.
  if (!import.meta.env.DEV) return new Response("Not found", { status: 404 });
  const session = await getSession(request);
  const userId = session.get("userId");
  // Each demo account gets the next persona, so a second demo account has different mail.
  const persona =
    userId && (await userExists(userId))
      ? (await listAccounts(userId)).filter((a) => a.provider === "demo").length
      : 0;
  const { label, name, domain } = DEMO_PERSONAS[persona % DEMO_PERSONAS.length];
  const id = randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "");
  return connectAccount(session, {
    provider: "demo",
    email: `alex.${label}.${id}@${domain}`,
    name,
    credentials: { persona },
  });
}
