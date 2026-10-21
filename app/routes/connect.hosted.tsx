import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "react-router";
import { connectAccount, redirectWithError } from "~/server/auth.server";
import { env, oauthConfigured } from "~/server/env.server";
import { getSession } from "~/server/session.server";
import type { Route } from "./+types/connect.hosted";

export const loader = () => redirect("/welcome");

/** Connects an address that mail by samayo hosts. The person must know the hosted mail password. */
export async function action({ request }: Route.ActionArgs) {
  const session = await getSession(request);
  if (!oauthConfigured.hosted) return redirectWithError(session, "/welcome", "Hosted mail is not set up on this server.");

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!env.hosted.mailboxes.includes(email) || !timingSafeEqual(digest(password), digest(env.hosted.password))) {
    return redirectWithError(session, "/welcome", "The address or the password is not correct.");
  }
  return connectAccount(session, { provider: "hosted", email, name: "", credentials: {} });
}
