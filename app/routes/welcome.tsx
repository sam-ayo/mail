import { data, redirect } from "react-router";
import { ErrorNote, HostedForm, ProviderButtons, ProviderLink, SignInCard } from "~/components/sign-in";
import { GoogleIcon, MicrosoftIcon } from "~/components/ui";
import { getUserId } from "~/server/auth.server";
import { oauthConfigured } from "~/server/env.server";
import { isDemoHost } from "~/server/demo-accounts.server";
import { readLastSignIn } from "~/server/last-sign-in.server";
import { getSession, sessionStorage } from "~/server/session.server";
import type { Route } from "./+types/welcome";

export const meta: Route.MetaFunction = () => [
  { title: "Log in · mail by samayo" },
  { name: "description", content: "mail by samayo is an email client. It shows your Gmail and Outlook accounts in one inbox." },
];

/** The sign-in screen. A signed-in person adds more accounts on /accounts/add. */
export async function loader({ request }: Route.LoaderArgs) {
  // OAuth sign-in does not work on the demo host. The demo page has a link to the app's own host.
  if (isDemoHost(request)) throw redirect("/demo");
  // The error of a failed "add account" stays in the session until /accounts/add shows it.
  if (await getUserId(request)) throw redirect("/accounts/add");
  const session = await getSession(request);
  const error = session.get("error");
  return data(
    { configured: oauthConfigured, error, last: await readLastSignIn(request) },
    { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } },
  );
}

export default function Welcome({ loaderData }: Route.ComponentProps) {
  const { configured, error, last } = loaderData;
  const lastOAuth =
    last?.provider === "google" || last?.provider === "microsoft" ? { ...last, provider: last.provider } : undefined;
  return (
    <SignInCard>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Log in to mail</h1>
      {/* Google compares this name with the app name on the OAuth consent screen. */}
      <p className="mt-2 text-sm text-zinc-500">mail by samayo shows your Gmail and Outlook in one inbox.</p>
      <p className="mt-2 text-sm text-zinc-500">
        Log in with your own account. After you log in, you can add more accounts, such as a team address.
      </p>

      <ErrorNote error={error} />

      {lastOAuth && (
        <div className="mt-6">
          <ProviderLink
            primary
            href={`/auth/${lastOAuth.provider}?hint=${encodeURIComponent(lastOAuth.email)}`}
            disabled={!configured[lastOAuth.provider]}
          >
            {lastOAuth.provider === "google" ? (
              <GoogleIcon className="size-5" />
            ) : (
              <MicrosoftIcon className="size-[18px]" />
            )}
            <span className="truncate">Continue as {lastOAuth.email}</span>
          </ProviderLink>
          <p className="mt-6 text-center text-xs text-zinc-400">Or use another account</p>
        </div>
      )}

      <ProviderButtons configured={configured} />

      {configured.hosted && (
        <HostedForm
          label="Log in with a hosted address"
          email={last?.provider === "hosted" ? last.email : undefined}
          open={last?.provider === "hosted"}
        />
      )}
    </SignInCard>
  );
}
