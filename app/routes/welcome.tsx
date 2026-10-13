import { ArrowLeft, Sparkle } from "@phosphor-icons/react";
import { data, Form, Link } from "react-router";
import { LegalLinks } from "~/components/legal";
import { GoogleIcon, Logo, MicrosoftIcon, cx } from "~/components/ui";
import { getUserId } from "~/server/auth.server";
import { oauthConfigured } from "~/server/env.server";
import { getSession, sessionStorage } from "~/server/session.server";
import type { Route } from "./+types/welcome";

export const meta: Route.MetaFunction = () => [{ title: "Sign in · mail" }];

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request);
  const error = session.get("error");
  return data(
    { configured: oauthConfigured, signedIn: !!(await getUserId(request)), error },
    { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } },
  );
}

export default function Welcome({ loaderData }: Route.ComponentProps) {
  const { configured, signedIn, error } = loaderData;
  return (
    <main className="flex min-h-full items-center justify-center bg-gradient-to-b from-accent-50/60 to-white p-6 dark:from-zinc-900 dark:to-zinc-950">
      <div className="w-full max-w-md">
        {signedIn && (
          <Link
            to="/mail"
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <ArrowLeft className="size-4" /> Back to mail
          </Link>
        )}
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900">
          <Logo className="text-lg" />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">
            {signedIn ? "Add another account" : "All your email, one fast inbox"}
          </h1>
          {signedIn && (
            <p className="mt-2 text-sm text-zinc-500">
              Connect as many accounts as you like. They all show in your unified inbox.
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-2.5">
            <ProviderLink href="/auth/google" disabled={!configured.google} hint="Not set up">
              <GoogleIcon className="size-5" /> Continue with Google
            </ProviderLink>
            <ProviderLink href="/auth/microsoft" disabled={!configured.microsoft} hint="Not set up">
              <MicrosoftIcon className="size-[18px]" /> Continue with Microsoft
            </ProviderLink>
          </div>

          {import.meta.env.DEV && (
            <>
              <div className="my-6 flex items-center gap-3 text-xs text-zinc-400">
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" /> or{" "}
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>

              <Form method="post" action="/connect/demo">
                <button className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-medium text-white press hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                  <Sparkle className="size-4" /> {signedIn ? "Add a demo account" : "Try a demo inbox"}
                </button>
              </Form>
            </>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-zinc-400">
          We encrypt your tokens and passwords before we store them.
        </p>
        <LegalLinks className="mt-3" />
      </div>
    </main>
  );
}

function ProviderLink({
  href,
  disabled,
  hint,
  children,
}: {
  href: string;
  disabled: boolean;
  hint: string;
  children: React.ReactNode;
}) {
  // Use a plain anchor. OAuth redirects leave the app, so a client-side
  // navigation does not help.
  return (
    <a
      href={href}
      title={disabled ? "Add the OAuth client ID and secret to .env to turn this on" : undefined}
      className={cx(
        "relative flex h-11 items-center justify-center gap-3 rounded-xl border border-zinc-200 text-sm font-medium press hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800",
        disabled && "opacity-60",
      )}
    >
      {children}
      {disabled && (
        <span className="absolute right-3 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
          {hint}
        </span>
      )}
    </a>
  );
}
