import { createCookieSessionStorage } from "react-router";
import { env } from "./env.server";

type SessionData = {
  userId: string;
};

/** An OAuth flow that the iOS app started. `userId` is set when the app adds an account. */
export type MobileFlow = {
  challenge: string;
  userId?: string;
};

type SessionFlashData = {
  oauthMobile: MobileFlow;
  oauthState: string;
  oauthVerifier: string;
  oauthReturnTo: string;
  error: string;
};

export const sessionStorage = createCookieSessionStorage<SessionData, SessionFlashData>({
  cookie: {
    name: "__mail_session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [env.sessionSecret],
    secure: env.isProduction,
    maxAge: 60 * 60 * 24 * 90,
  },
});

export function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}
