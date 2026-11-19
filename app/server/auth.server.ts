import { createHash, timingSafeEqual } from "node:crypto";
import type { Session } from "react-router";
import { redirect } from "react-router";
import type { ProviderKind } from "~/lib/mail";
import type { Credentials } from "./accounts.server";
import type { OAuthCredentials } from "./accounts.server";
import {
  createUser,
  findAccountWorkspaces,
  findSignIn,
  getAccountById,
  insertSignIn,
  isDemoUser,
  resolveUser,
  resolveUserAccounts,
  sessionVersion,
  setAccountSubject,
  updateCredentials,
  upsertAccount,
} from "./accounts.server";
import { env } from "./env.server";
import { isConsumerMicrosoftSubject, microsoftStoredSubject } from "./oauth/microsoft.server";
import { writeLastSignIn } from "./last-sign-in.server";
import { closeImapConnection } from "./providers/imap.server";
import { getSession, sessionStorage } from "./session.server";

/** The workspace of the session, or undefined. A cookie from before a "sign out everywhere" gives undefined. */
export function sessionUser(session: Session) {
  return resolveUser(session.get("userId"), session.get("version") ?? 0);
}

/** Puts the workspace and its session version in the session. */
export async function startSession(session: Session, userId: string) {
  session.set("userId", userId);
  session.set("version", await sessionVersion(userId));
}

export async function getUserId(request: Request) {
  return (await sessionUser(await getSession(request))) ?? null;
}

/** The signed-in user and the user's accounts, or null. */
export async function getUser(request: Request) {
  const session = await getSession(request);
  return (await resolveUserAccounts(session.get("userId"), session.get("version") ?? 0)) ?? null;
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
  input: { provider: ProviderKind; email: string; name: string; credentials: Credentials; subject?: string },
  returnTo = "/mail/all/inbox",
) {
  let current = await sessionUser(session);
  // A real mailbox does not join a demo workspace, because the cron job deletes that workspace.
  if (current && input.provider !== "demo" && (await isDemoUser(current))) current = undefined;
  // A sign-in opens a workspace in a browser that has none.
  const signIn = !current;
  if (!current) {
    // A browser with no workspace. Only a sign-in account opens its workspace.
    // Other accounts can be shared mailboxes: a person who uses a team address
    // must not see the other mailboxes of a workspace that has it.
    const workspaces = await sameMailboxWorkspaces(input);
    const owner = workspaces.find((w) => w.canSignIn || input.provider === "demo");
    if (owner) current = owner.userId;
    else if (workspaces.length > 0) {
      return redirectWithError(session, "/welcome", sharedMailboxError(input.email));
    }
  }
  // A browser with a workspace adds the mailbox to it, after a sign-in to the
  // mailbox. Other workspaces that have the mailbox keep their own account.
  const newWorkspace = !current;
  const userId = current ?? (await createUser());
  const accountId = await upsertAccount({ userId, ...input, canSignIn: newWorkspace });
  // Drop a pooled connection that still uses an old password.
  if (input.provider === "imap") closeImapConnection(accountId);
  await startSession(session, userId);
  const headers = new Headers({ "Set-Cookie": await sessionStorage.commitSession(session) });
  if (signIn && input.provider !== "demo") {
    headers.append("Set-Cookie", await writeLastSignIn({ provider: input.provider, email: input.email.toLowerCase() }));
  }
  return redirect(returnTo, { headers });
}

/**
 * Signs the browser in with a person from a sign-in that has no mail access.
 * The workspace of the person opens. A workspace from before sign-ins opens
 * through its sign-in mailbox. A new person gets a new workspace with no
 * mailbox, and adds mailboxes on /accounts/add. An address that is a shared
 * mailbox in a workspace, and that never logged in, cannot log in.
 */
export async function signInWithIdentity(
  session: Session,
  identity: { provider: "google" | "microsoft"; email: string; subject: string },
  returnTo = "/mail/all/inbox",
) {
  let userId = await resolveUser(await findSignIn(identity.provider, identity.subject));
  if (!userId) {
    const workspaces = await sameMailboxWorkspaces(identity);
    userId = workspaces.find((w) => w.canSignIn)?.userId;
    // The address is a shared mailbox in a workspace, and it never logged in.
    // A shared address must not get a workspace of its own.
    if (!userId && workspaces.length > 0) {
      return redirectWithError(session, "/welcome", sharedMailboxError(identity.email));
    }
  }
  const newWorkspace = !userId;
  if (!userId) {
    // A new person gets an own workspace and adds mailboxes to it.
    userId = await createUser();
    await insertSignIn({ userId, ...identity });
  }
  await startSession(session, userId);
  const headers = new Headers({ "Set-Cookie": await sessionStorage.commitSession(session) });
  headers.append("Set-Cookie", await writeLastSignIn({ provider: identity.provider, email: identity.email.toLowerCase() }));
  return redirect(newWorkspace ? "/accounts/add" : returnTo, { headers });
}

/**
 * The workspaces whose account is the same mailbox as the sign-in. With a
 * subject, an account must have the same subject. An account from before
 * subjects gets its subject here, after a check:
 * - Google: the sign-in address is verified, so the address is enough.
 * - Microsoft: a personal account has a verified address. For a work or school
 *   account, the stored refresh token of the account gives its subject.
 */
async function sameMailboxWorkspaces(input: { provider: ProviderKind; email: string; subject?: string }) {
  const workspaces = await findAccountWorkspaces(input.provider, input.email, input.subject);
  const subject = input.subject;
  if (!subject) return workspaces;
  const checked = [];
  for (const workspace of workspaces) {
    if (workspace.subject === null && !(await sameLegacySubject(input.provider, subject, workspace.accountId))) continue;
    if (workspace.subject === null) await setAccountSubject(workspace.accountId, subject);
    checked.push(workspace);
  }
  return checked;
}

async function sameLegacySubject(provider: ProviderKind, subject: string, accountId: string) {
  if (provider === "google" || isConsumerMicrosoftSubject(subject)) return true;
  if (provider !== "microsoft") return false;
  try {
    const account = await getAccountById(accountId);
    const stored = await microsoftStoredSubject(account!.credentials as OAuthCredentials);
    await updateCredentials(accountId, stored.credentials);
    return stored.subject === subject;
  } catch {
    // The stored token does not work. The account cannot prove its subject, so it does not match.
    return false;
  }
}

/** The error for a login with an address that is a shared mailbox in a workspace. */
export function sharedMailboxError(email: string) {
  return `${email} is a shared mailbox. Log in with your own email address. Then use "Add account" to add ${email}.`;
}

export async function redirectWithError(session: Session, to: string, error: string) {
  session.flash("error", error);
  return redirect(to, {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

/**
 * Signs out of mail, and out of the Better Auth session of an OAuth flow. The
 * agents that the workspace allowed stay connected.
 */
export async function signOut(request: Request) {
  const session = await getSession(request);
  const headers = new Headers({ "Set-Cookie": await sessionStorage.destroySession(session) });
  // Better Auth starts only for a browser that started an OAuth flow.
  if (request.headers.get("Cookie")?.includes("agent-auth.session_token")) {
    const { getAgentAuth } = await import("./agent-auth.server");
    const result = await getAgentAuth().api.signOut({ headers: request.headers, returnHeaders: true });
    for (const cookie of result.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  }
  return redirect("/welcome", { headers });
}
