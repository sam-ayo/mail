import { env } from "../env.server";
import type { OAuthCredentials } from "../accounts.server";
import { ProviderAuthError } from "../providers/types";

/** A sign-in asks only who the person is. Mail access comes when the person adds a mailbox. */
const SIGN_IN_SCOPES = ["openid", "email", "profile"];
const SCOPES = [...SIGN_IN_SCOPES, "https://www.googleapis.com/auth/gmail.modify"];

export const googleRedirectUri = () => `${env.appUrl}/auth/google/callback`;

export function googleAuthorizeUrl(state: string, codeChallenge: string, loginHint?: string, signIn = false) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    ...(signIn
      ? { scope: SIGN_IN_SCOPES.join(" "), prompt: "select_account" }
      : {
          scope: SCOPES.join(" "),
          access_type: "offline",
          // "consent" makes Google return a refresh token on every sign-in.
          prompt: "consent select_account",
          include_granted_scopes: "true",
        }),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      ...params,
    }),
  });
  const body = (await response.json()) as TokenResponse;
  if (!response.ok) {
    if (body.error === "invalid_grant") throw new ProviderAuthError();
    throw new Error(`Google token request failed: ${body.error_description || body.error}`);
  }
  return body;
}

function exchange(code: string, codeVerifier: string) {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: googleRedirectUri(),
  });
}

/** The person of a sign-in. The app gets no mail access and keeps no token. */
export async function googleIdentity(code: string, codeVerifier: string) {
  const tokens = await exchange(code, codeVerifier);
  return verifiedProfile(tokens.access_token);
}

export async function googleExchangeCode(code: string, codeVerifier: string) {
  const tokens = await exchange(code, codeVerifier);
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token. Try to connect the account again.");
  }
  const credentials: OAuthCredentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  return { ...(await verifiedProfile(tokens.access_token)), credentials };
}

async function verifiedProfile(accessToken: string) {
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = (await profileResponse.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  // Google identifies the person with "sub". An address that Google did not verify does not identify a mailbox.
  if (!profile.sub || !profile.email || profile.email_verified !== true) {
    throw new Error("Google did not verify the address of this account.");
  }
  return { email: profile.email, name: profile.name ?? "", subject: profile.sub };
}

export async function googleRefresh(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  const tokens = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: credentials.refreshToken,
  });
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? credentials.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}
