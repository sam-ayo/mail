import { redirect } from "react-router";
import { GoogleIcon, Logo, MicrosoftIcon } from "~/components/ui";
import { agentAuth } from "~/server/agent-auth.server";
import { getUserId } from "~/server/auth.server";
import { oauthConfigured } from "~/server/env.server";
import type { Route } from "./+types/oauth.login";

export const meta: Route.MetaFunction = () => [{ title: "Connect an AI agent · mail by samayo" }];

// Parameters that Better Auth adds when it signs the query. The authorize
// endpoint must not get them again. "prompt" goes too: "prompt=login" sends
// the browser back to this page each time.
const SIGNED_QUERY_PARAMS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param", "prompt"];

/**
 * The login step of the OAuth flow. A workspace has no password, so the mail
 * session of this browser identifies the workspace. The page starts a Better
 * Auth session for it, then sends the browser back to the authorize endpoint.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const workspaceId = await getUserId(request);
  if (!workspaceId) {
    return { returnTo: url.pathname + url.search, configured: oauthConfigured };
  }

  const { headers } = await agentAuth.api.workspaceSignIn({
    body: { workspaceId },
    returnHeaders: true,
  });
  const authorize = new URL("/api/auth/oauth2/authorize", url);
  for (const [key, value] of url.searchParams) {
    if (!SIGNED_QUERY_PARAMS.includes(key)) authorize.searchParams.append(key, value);
  }
  const response = redirect(authorize.pathname + authorize.search);
  for (const cookie of headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
  return response;
}

export default function OAuthLogin({ loaderData }: Route.ComponentProps) {
  const { returnTo, configured } = loaderData;
  const link = (provider: string) => `/auth/${provider}?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <main className="flex min-h-full items-center justify-center bg-gradient-to-b from-accent-50/60 to-white p-6 dark:from-zinc-900 dark:to-zinc-950">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900">
        <Logo className="text-lg" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Sign in to connect an AI agent</h1>
        <p className="mt-2 text-sm text-zinc-500">
          This browser is not signed in to mail by samayo. Sign in with an account of your workspace. Then you can give the
          agent access.
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          {configured.google && (
            <a
              href={link("google")}
              className="flex h-11 items-center justify-center gap-3 rounded-xl border border-zinc-200 text-sm font-medium press hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <GoogleIcon className="size-5" /> Continue with Google
            </a>
          )}
          {configured.microsoft && (
            <a
              href={link("microsoft")}
              className="flex h-11 items-center justify-center gap-3 rounded-xl border border-zinc-200 text-sm font-medium press hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <MicrosoftIcon className="size-[18px]" /> Continue with Microsoft
            </a>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-zinc-400">
          For an IMAP or hosted address, open mail by samayo in this browser and sign in. Then connect the agent again.
        </p>
      </div>
    </main>
  );
}
