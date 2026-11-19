import { data, redirect } from "react-router";
import { randomToken, sha256Base64Url } from "~/server/crypto.server";
import { env, oauthConfigured } from "~/server/env.server";
import { getUserId, redirectWithError } from "~/server/auth.server";
import { composioStartGmail } from "~/server/oauth/composio.server";
import { googleAuthorizeUrl, googleRedirectUri } from "~/server/oauth/google.server";
import { microsoftAuthorizeUrl } from "~/server/oauth/microsoft.server";
import { getSession, sessionStorage } from "~/server/session.server";
import type { Route } from "./+types/auth.start";

export async function loader({ request, params }: Route.LoaderArgs) {
  const provider = params.provider;
  if (provider !== "google" && provider !== "microsoft") {
    throw data("Unknown provider", { status: 404 });
  }
  const session = await getSession(request);
  if (!oauthConfigured[provider]) {
    const name = provider === "google" ? "Google" : "Microsoft";
    return redirectWithError(
      session,
      "/welcome",
      `${name} login is not set up on this server. Add the OAuth client ID and secret to .env.`,
    );
  }

  const url = new URL(request.url);
  session.flash("oauthReturnTo", url.searchParams.get("returnTo") ?? "/mail/all/inbox");
  // A browser with no workspace signs in first: the flow asks only who the
  // person is, with no mail access. A signed-in browser adds a mailbox.
  // Google needs the own OAuth client of the app for a sign-in.
  const signIn =
    !(await getUserId(request)) && (provider === "microsoft" || !!(env.google.clientId && env.google.clientSecret));
  if (signIn) session.flash("oauthIntent", "signin");

  // With a Composio key, Gmail connects through the Google app of Composio.
  if (provider === "google" && env.composio.apiKey && !signIn) {
    try {
      const start = await composioStartGmail(googleRedirectUri());
      session.flash("composioAccountId", start.composioAccountId);
      session.flash("composioUserId", start.composioUserId);
      return redirect(start.redirectUrl, {
        headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
      });
    } catch {
      return redirectWithError(session, "/welcome", "Gmail is not available now. Try again later.");
    }
  }

  const state = randomToken();
  const verifier = randomToken(48);
  session.flash("oauthState", state);
  session.flash("oauthVerifier", verifier);

  const hint = url.searchParams.get("hint") ?? undefined;
  const challenge = sha256Base64Url(verifier);
  const authorizeUrl =
    provider === "google"
      ? googleAuthorizeUrl(state, challenge, hint, signIn)
      : microsoftAuthorizeUrl(state, challenge, hint, signIn);

  return redirect(authorizeUrl, {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}
