import { createUser, listAccounts, upsertAccount, userExists } from "~/server/accounts.server";
import { getUserId } from "~/server/auth.server";
import { randomToken } from "~/server/crypto.server";
import { createMobileSession } from "~/server/mobile.server";
import { DEMO_PERSONAS } from "~/server/providers/demo.server";
import type { Route } from "./+types/api.mobile.demo";

/**
 * Development only. Adds a demo account and returns a token, with no OAuth.
 * A signed-in app gets the account added to its user.
 */
export async function action({ request }: Route.ActionArgs) {
  if (!import.meta.env.DEV) return new Response("Not found", { status: 404 });
  let userId = await getUserId(request);
  const signedIn = !!userId && (await userExists(userId));
  if (!signedIn) userId = await createUser();
  const demos = (await listAccounts(userId!)).filter((a) => a.provider === "demo").length;
  const persona = demos % DEMO_PERSONAS.length;
  const { label, name, domain, look } = DEMO_PERSONAS[persona];
  const id = randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "");
  await upsertAccount({
    userId: userId!,
    provider: "demo",
    email: `alex.${label}.${id}@${domain}`,
    name,
    credentials: { persona, look },
  });
  const token = signedIn ? undefined : await createMobileSession(userId!, "Demo");
  return Response.json({ token });
}
