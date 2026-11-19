import { env } from "../env.server";
import type { OAuthCredentials } from "../accounts.server";
import { ProviderAuthError } from "../providers/types";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
];

const authority = () => `https://login.microsoftonline.com/${env.microsoft.tenant}/oauth2/v2.0`;

export const microsoftRedirectUri = () => `${env.appUrl}/auth/microsoft/callback`;

export function microsoftAuthorizeUrl(state: string, codeChallenge: string, loginHint?: string) {
  const url = new URL(`${authority()}/authorize`);
  url.search = new URLSearchParams({
    client_id: env.microsoft.clientId,
    redirect_uri: microsoftRedirectUri(),
    response_type: "code",
    response_mode: "query",
    scope: SCOPES.join(" "),
    prompt: "select_account",
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
  id_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>) {
  const response = await fetch(`${authority()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.microsoft.clientId,
      client_secret: env.microsoft.clientSecret,
      scope: SCOPES.join(" "),
      ...params,
    }),
  });
  const body = (await response.json()) as TokenResponse;
  if (!response.ok) {
    if (body.error === "invalid_grant" || body.error === "interaction_required") {
      throw new ProviderAuthError();
    }
    throw new Error(`Microsoft token request failed: ${body.error_description || body.error}`);
  }
  return body;
}

export async function microsoftExchangeCode(code: string, codeVerifier: string) {
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: microsoftRedirectUri(),
  });
  if (!tokens.refresh_token) {
    throw new Error("Microsoft did not return a refresh token. Try to connect the account again.");
  }
  const subject = microsoftSubject(tokens.id_token);
  const profileResponse = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );
  const profile = (await profileResponse.json()) as {
    displayName?: string;
    mail?: string;
    userPrincipalName: string;
  };
  const credentials: OAuthCredentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  return {
    email: profile.mail || profile.userPrincipalName,
    name: profile.displayName ?? "",
    credentials,
    subject,
  };
}

/** The tenant of personal Microsoft accounts (outlook.com, hotmail.com, live.com). */
const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

/**
 * The immutable ID of the person: "tid:oid" from the ID token. The token
 * comes straight from the token endpoint over TLS, so the app does not check
 * its signature. Do not identify a Microsoft account by its email address: a
 * tenant administrator can set the mail attribute of a user to any address.
 */
export function microsoftSubject(idToken: string | undefined) {
  const [, payload] = (idToken ?? "").split(".");
  const claims = payload ? (JSON.parse(Buffer.from(payload, "base64url").toString()) as { tid?: string; oid?: string }) : {};
  if (!claims.tid || !claims.oid) throw new Error("Microsoft did not identify the account. Try again.");
  return `${claims.tid}:${claims.oid}`;
}

/**
 * The subject of an account from before subjects, from a refresh with its own
 * stored refresh token. Only the real owner of the mailbox gave that token.
 */
export async function microsoftStoredSubject(credentials: OAuthCredentials) {
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: credentials.refreshToken });
  const next: OAuthCredentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? credentials.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  return { subject: microsoftSubject(tokens.id_token), credentials: next };
}

/** True for a personal Microsoft account. Microsoft verifies the address of these accounts. */
export function isConsumerMicrosoftSubject(subject: string) {
  return subject.startsWith(`${CONSUMER_TENANT}:`);
}

export async function microsoftRefresh(credentials: OAuthCredentials): Promise<OAuthCredentials> {
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
