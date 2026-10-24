import { redirect } from "react-router";
import { listAccounts, resolveUser } from "~/server/accounts.server";
import { connectAccount } from "~/server/auth.server";
import { demoAccount } from "~/server/demo-accounts.server";
import { DEMO_PERSONAS } from "~/server/providers/demo.server";
import { getSession } from "~/server/session.server";
import type { Route } from "./+types/connect.demo";

export const loader = () => redirect("/welcome");

export async function action({ request }: Route.ActionArgs) {
  // Development only. Production users connect real accounts.
  if (!import.meta.env.DEV) return new Response("Not found", { status: 404 });
  const session = await getSession(request);
  const userId = await resolveUser(session.get("userId"));
  const chosen = Number((await request.formData()).get("persona"));
  // Without a choice, each demo account gets the next persona, so a second demo account has different mail.
  const persona = Number.isInteger(chosen) && chosen >= 0 && chosen < DEMO_PERSONAS.length
    ? chosen
    : userId
      ? (await listAccounts(userId)).filter((a) => a.provider === "demo").length % DEMO_PERSONAS.length
      : 0;
  return connectAccount(session, await demoAccount(persona));
}
