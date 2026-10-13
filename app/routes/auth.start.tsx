import { data, redirect } from "react-router";
import { randomToken, sha256Base64Url } from "~/server/crypto.server";
import { oauthConfigured } from "~/server/env.server";
import { redirectWithError } from "~/server/auth.server";
import { googleAuthorizeUrl } from "~/server/oauth/google.server";
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
      `${name} sign-in is not set up on this server. Add the OAuth client ID and secret to .env.`,
    );
  }

  const url = new URL(request.url);
  const state = randomToken();
  const verifier = randomToken(48);
  session.flash("oauthState", state);
  session.flash("oauthVerifier", verifier);
  session.flash("oauthReturnTo", url.searchParams.get("returnTo") ?? "/mail");

  const hint = url.searchParams.get("hint") ?? undefined;
  const challenge = sha256Base64Url(verifier);
  const authorizeUrl =
    provider === "google"
      ? googleAuthorizeUrl(state, challenge, hint)
      : microsoftAuthorizeUrl(state, challenge, hint);

  return redirect(authorizeUrl, {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}
