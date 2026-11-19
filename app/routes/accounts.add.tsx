import { ArrowLeft } from "~/components/icons";
import { data, Link, redirect } from "react-router";
import { ErrorNote, HostedForm, ProviderButtons, SignInCard } from "~/components/sign-in";
import { getUser } from "~/server/auth.server";
import { oauthConfigured } from "~/server/env.server";
import { getSession, sessionStorage } from "~/server/session.server";
import type { Route } from "./+types/accounts.add";

export const meta: Route.MetaFunction = () => [{ title: "Add an account · mail by samayo" }];

/** Adds a mailbox to the signed-in workspace. A browser with no workspace signs in on /welcome first. */
export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  if (!user) throw redirect("/welcome");
  const session = await getSession(request);
  const error = session.get("error");
  return data(
    { configured: oauthConfigured, error, first: user.accounts.length === 0 },
    { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } },
  );
}

export default function AddAccount({ loaderData }: Route.ComponentProps) {
  const { configured, error, first } = loaderData;
  return (
    <SignInCard
      top={
        // A new workspace has no mail yet, so it has no "Back to mail" link.
        !first && (
          <Link
            to="/mail/all/inbox"
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <ArrowLeft className="size-4" /> Back to mail
          </Link>
        )
      }
    >
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{first ? "Add your first account" : "Add an account"}</h1>
      <p className="mt-2 text-sm text-zinc-500">
        {first
          ? "You are logged in. Now give mail by samayo access to a mailbox. Its mail shows in your inbox."
          : "Sign in to the account that you want to add. Its mail shows in your inbox with your other accounts."}
      </p>

      <ErrorNote error={error} />

      <ProviderButtons configured={configured} />

      {configured.hosted && <HostedForm label="Add a hosted address" />}
    </SignInCard>
  );
}
