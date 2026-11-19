import { createCookie } from "react-router";
import type { ProviderKind } from "~/lib/mail";
import { env } from "./env.server";

/**
 * The account that last opened a workspace in this browser. The sign-in
 * screen shows it first, so a person does not sign in with a shared mailbox
 * by mistake. The cookie stays after a sign-out.
 */
export type LastSignIn = { provider: ProviderKind; email: string };

const cookie = createCookie("__mail_last_sign_in", {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secrets: [env.sessionSecret],
  secure: env.isProduction,
  maxAge: 60 * 60 * 24 * 400,
});

export async function readLastSignIn(request: Request): Promise<LastSignIn | undefined> {
  const value = await cookie.parse(request.headers.get("Cookie"));
  if (!value || typeof value.email !== "string" || typeof value.provider !== "string") return undefined;
  return { provider: value.provider, email: value.email };
}

export function writeLastSignIn(value: LastSignIn) {
  return cookie.serialize(value);
}
