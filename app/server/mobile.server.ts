import { randomToken, sha256Base64Url, signPayload, verifyPayload } from "./crypto.server";
import { query, queryOne } from "./db.server";

// The iOS app signs in with a bearer token, not a cookie. The OAuth flow runs
// in a browser sheet, then sends the app a one-time code. The app trades the
// code and its PKCE verifier for a token at /api/mobile/token.

/** The custom URL scheme of the iOS app. The OAuth callback returns to it. */
export const MOBILE_CALLBACK = "relaymail://auth";

const CODE_LIFETIME_MS = 2 * 60 * 1000;
const LINK_LIFETIME_MS = 10 * 60 * 1000;

interface CodePayload {
  kind: "code";
  userId: string;
  challenge: string;
  exp: number;
}

interface LinkPayload {
  kind: "link";
  userId: string;
  exp: number;
}

/** A PKCE S256 challenge is 43 base64url characters. */
export function isChallenge(value: string | null): value is string {
  return !!value && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function createAuthCode(userId: string, challenge: string) {
  return signPayload({ kind: "code", userId, challenge, exp: Date.now() + CODE_LIFETIME_MS } satisfies CodePayload);
}

/** Returns the user ID if the code is valid and the verifier matches its challenge. */
export function redeemAuthCode(code: string, verifier: string) {
  const payload = verifyPayload<CodePayload>(code);
  if (!payload || payload.kind !== "code" || payload.exp < Date.now()) return null;
  return sha256Base64Url(verifier) === payload.challenge ? payload.userId : null;
}

/** A ticket lets a signed-in app add an account to its user in the browser sheet. */
export function createLinkTicket(userId: string) {
  return signPayload({ kind: "link", userId, exp: Date.now() + LINK_LIFETIME_MS } satisfies LinkPayload);
}

export function readLinkTicket(ticket: string | null) {
  const payload = ticket ? verifyPayload<LinkPayload>(ticket) : null;
  return payload && payload.kind === "link" && payload.exp >= Date.now() ? payload.userId : null;
}

export async function createMobileSession(userId: string, deviceName: string) {
  const token = randomToken(32);
  await query("INSERT INTO mobile_sessions (token_hash, user_id, device_name) VALUES ($1, $2, $3)", [
    sha256Base64Url(token),
    userId,
    deviceName.slice(0, 100),
  ]);
  return token;
}

export async function mobileSessionUser(token: string) {
  const row = await queryOne<{ user_id: string }>(
    // Write the last use at most one time each hour.
    `UPDATE mobile_sessions SET last_used_at = CASE
       WHEN last_used_at < now() - interval '1 hour' THEN now() ELSE last_used_at END
     WHERE token_hash = $1 RETURNING user_id`,
    [sha256Base64Url(token)],
  );
  return row?.user_id ?? null;
}

export async function deleteMobileSession(token: string) {
  await query("DELETE FROM mobile_sessions WHERE token_hash = $1", [sha256Base64Url(token)]);
}

export function bearerToken(request: Request) {
  const match = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}
