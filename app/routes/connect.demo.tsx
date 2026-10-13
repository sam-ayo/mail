import { redirect } from "react-router";
import { findAccountOwner, listAccounts, userExists } from "~/server/accounts.server";
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
  const chosen = Number((await request.formData()).get("persona"));
  // Without a choice, each demo account gets the next persona, so a second demo account has different mail.
  const persona = Number.isInteger(chosen) && chosen >= 0 && chosen < DEMO_PERSONAS.length
    ? chosen
    : userId && (await userExists(userId))
      ? (await listAccounts(userId)).filter((a) => a.provider === "demo").length % DEMO_PERSONAS.length
      : 0;
  const { label, name, domain, email, look } = DEMO_PERSONAS[persona];
  const id = randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "");
  return connectAccount(session, {
    provider: "demo",
    email: email ? await freeEmail(email) : `alex.${label}.${id}@${domain}`,
    name,
    credentials: { persona, look },
  });
}

/** A connection with an existing address refreshes that account. Thus a second
    account of the same persona gets a number: alex@northwind.io, then alex2@northwind.io. */
async function freeEmail(email: string) {
  const [local, domain] = email.split("@");
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? email : `${local}${n}@${domain}`;
    if (!(await findAccountOwner("demo", candidate))) return candidate;
  }
}
