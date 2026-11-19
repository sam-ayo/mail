import { createCookieSessionStorage } from "react-router";
import { env } from "./env.server";

type SessionData = {
  userId: string;
  /** The session version of the workspace when the browser signed in. See users.session_version. */
  version: number;
};

type SessionFlashData = {
  oauthState: string;
  oauthVerifier: string;
  oauthReturnTo: string;
  composioAccountId: string;
  composioUserId: string;
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
