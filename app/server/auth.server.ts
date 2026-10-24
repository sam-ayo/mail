import { createHash, timingSafeEqual } from "node:crypto";
import type { Session } from "react-router";
import { redirect } from "react-router";
import type { ProviderKind } from "~/lib/mail";
import type { Credentials } from "./accounts.server";
import {
  createUser,
  findAccountOwner,
  isDemoUser,
  mergeUsers,
  resolveUser,
  resolveUserAccounts,
  upsertAccount,
} from "./accounts.server";
import { env } from "./env.server";
import { closeImapConnection } from "./providers/imap.server";
import { getSession, sessionStorage } from "./session.server";

export async function getUserId(request: Request) {
  const session = await getSession(request);
  return (await resolveUser(session.get("userId"))) ?? null;
}

/** The signed-in user and the user's accounts, or null. */
export async function getUser(request: Request) {
  const session = await getSession(request);
  return (await resolveUserAccounts(session.get("userId"))) ?? null;
}

/** For resource routes that the layout middleware does not cover. */
export async function requireUserId(request: Request) {
  const userId = await getUserId(request);
  if (!userId) throw new Response("Unauthorized", { status: 401 });
  return userId;
}

/** For the scheduled jobs. They send the cron secret in the Authorization header. */
export function requireCronSecret(request: Request) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const given = request.headers.get("authorization") ?? "";
  if (!env.cronSecret || !timingSafeEqual(digest(given), digest(`Bearer ${env.cronSecret}`))) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

/**
 * Connects a mailbox and signs the browser in. If the browser has no session,
 * the mailbox's existing workspace is restored, or a new workspace is created.
 */
export async function connectAccount(
  session: Session,
  input: { provider: ProviderKind; email: string; name: string; credentials: Credentials },
  returnTo = "/mail/all/inbox",
) {
  let current = await resolveUser(session.get("userId"));
  // A real mailbox does not join a demo workspace, because the cron job deletes that workspace.
  if (current && input.provider !== "demo" && (await isDemoUser(current))) current = undefined;
  const owner = await findAccountOwner(input.provider, input.email);
  // The mailbox is in another workspace. Join the two, so that each browser
  // keeps all its accounts.
  if (current && owner && current !== owner) await mergeUsers(current, owner);
  const userId = owner ?? current ?? (await createUser());
  const accountId = await upsertAccount({ userId, ...input });
  // Drop a pooled connection that still uses an old password.
  if (input.provider === "imap") closeImapConnection(accountId);
  session.set("userId", userId);
  return redirect(returnTo, {
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
