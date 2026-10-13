import type { Session } from "react-router";
import { redirect } from "react-router";
import type { ProviderKind } from "~/lib/mail";
import type { Credentials } from "./accounts.server";
import type { MobileFlow } from "./session.server";
import { createUser, findAccountOwner, upsertAccount, userExists } from "./accounts.server";
import { bearerToken, createAuthCode, MOBILE_CALLBACK, mobileSessionUser } from "./mobile.server";
import { closeImapConnection } from "./providers/imap.server";
import { getSession, sessionStorage } from "./session.server";

export async function getUserId(request: Request) {
  // The iOS app sends a bearer token. Browsers send the session cookie.
  const token = bearerToken(request);
  if (token) return mobileSessionUser(token);
  const session = await getSession(request);
  const userId = session.get("userId");
  return userId && (await userExists(userId)) ? userId : null;
}

/** For resource routes that the layout middleware does not cover. */
export async function requireUserId(request: Request) {
  const userId = await getUserId(request);
  if (!userId) throw new Response("Unauthorized", { status: 401 });
  return userId;
}

/**
 * Connects a mailbox and signs the browser in. If the browser has no session,
 * the mailbox's existing workspace is restored, or a new workspace is created.
 */
export async function connectAccount(
  session: Session,
  input: { provider: ProviderKind; email: string; name: string; credentials: Credentials },
  returnTo = "/mail",
) {
  let userId = session.get("userId");
  if (!userId || !(await userExists(userId))) {
    userId = (await findAccountOwner(input.provider, input.email)) ?? (await createUser());
  }
  const accountId = await upsertAccount({ userId, ...input });
  // Drop a pooled connection that still uses an old password.
  if (input.provider === "imap") closeImapConnection(accountId);
  session.set("userId", userId);
  return redirect(returnTo, {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

/**
 * Connects a mailbox for the iOS app. The browser sheet gets no session. It
 * goes back to the app with a one-time code for the PKCE challenge of the app.
 */
export async function connectMobileAccount(
  session: Session,
  mobile: MobileFlow,
  input: { provider: ProviderKind; email: string; name: string; credentials: Credentials },
) {
  let userId = mobile.userId && (await userExists(mobile.userId)) ? mobile.userId : null;
  userId ??= (await findAccountOwner(input.provider, input.email)) ?? (await createUser());
  await upsertAccount({ userId, ...input });
  const code = createAuthCode(userId, mobile.challenge);
  return redirect(`${MOBILE_CALLBACK}?${new URLSearchParams({ code })}`, {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

/** Sends an error back to the iOS app. */
export async function mobileRedirectWithError(session: Session, error: string) {
  return redirect(`${MOBILE_CALLBACK}?${new URLSearchParams({ error })}`, {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

export async function redirectWithError(session: Session, to: string, error: string) {
  session.flash("error", error);
  return redirect(to, {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

export async function signOut(request: Request) {
  const session = await getSession(request);
  return redirect("/welcome", {
    headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
  });
}
