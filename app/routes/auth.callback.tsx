import { data } from "react-router";
import { connectAccount, redirectWithError } from "~/server/auth.server";
import { composioFinishGmail } from "~/server/oauth/composio.server";
import { googleExchangeCode } from "~/server/oauth/google.server";
import { microsoftExchangeCode } from "~/server/oauth/microsoft.server";
import { getSession } from "~/server/session.server";
import { errorMessage } from "~/server/util.server";
import type { Route } from "./+types/auth.callback";

export async function loader({ request, params }: Route.LoaderArgs) {
  const provider = params.provider;
  if (provider !== "google" && provider !== "microsoft") {
    throw data("Unknown provider", { status: 404 });
  }

  const session = await getSession(request);
  const expectedState = session.get("oauthState");
  const verifier = session.get("oauthVerifier");
  const returnTo = session.get("oauthReturnTo") ?? "/mail/all/inbox";
  const url = new URL(request.url);
  // Allow only paths in this app. "//host" and "/\\host" go to other sites.
  const safeReturnTo = /^\/(?![/\\])/.test(returnTo) ? returnTo : "/mail/all/inbox";

  // Composio sends the user back with status and connected_account_id. The
  // ID must be the one that this browser started, because anyone can type
  // these parameters.
  const composioAccountId = url.searchParams.get("connected_account_id");
  if (provider === "google" && composioAccountId) {
    const expectedId = session.get("composioAccountId");
    const composioUserId = session.get("composioUserId");
    if (url.searchParams.get("status") !== "success") {
      return redirectWithError(session, "/welcome", "Gmail did not connect. Try again.");
    }
    if (!expectedId || !composioUserId || composioAccountId !== expectedId) {
      return redirectWithError(session, "/welcome", "The sign-in link expired. Try again.");
    }
    try {
      const profile = await composioFinishGmail({ composioAccountId, composioUserId });
      return connectAccount(session, { provider, ...profile }, safeReturnTo);
    } catch (error) {
      return redirectWithError(session, "/welcome", errorMessage(error));
    }
  }

  const providerError = url.searchParams.get("error");
  if (providerError) {
    const description = url.searchParams.get("error_description");
    const message =
      providerError === "access_denied"
        ? "You cancelled the sign-in."
        : `Sign-in failed: ${description ?? providerError}`;
    return redirectWithError(session, "/welcome", message);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !verifier || state !== expectedState) {
    return redirectWithError(session, "/welcome", "The sign-in link expired. Try again.");
  }

  try {
    const profile =
      provider === "google"
        ? await googleExchangeCode(code, verifier)
        : await microsoftExchangeCode(code, verifier);
    return connectAccount(session, { provider, ...profile }, safeReturnTo);
  } catch (error) {
    return redirectWithError(session, "/welcome", errorMessage(error));
  }
}
