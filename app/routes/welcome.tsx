import { ArrowLeft, EnvelopeSimple } from "~/components/icons";
import { data, Form, Link, redirect } from "react-router";
import { LegalLinks } from "~/components/legal";
import { GoogleIcon, Logo, MicrosoftIcon, cx, inputClass } from "~/components/ui";
import { getUserId } from "~/server/auth.server";
import { oauthConfigured } from "~/server/env.server";
import { isDemoHost } from "~/server/demo-accounts.server";
import { getSession, sessionStorage } from "~/server/session.server";
import type { Route } from "./+types/welcome";

export const meta: Route.MetaFunction = () => [
  { title: "Sign in · mail by samayo" },
  { name: "description", content: "mail by samayo is an email client. It shows your Gmail and Outlook accounts in one inbox." },
];

export async function loader({ request }: Route.LoaderArgs) {
  // OAuth sign-in does not work on the demo host. The demo page has a link to the app's own host.
  if (isDemoHost(request)) throw redirect("/demo");
  const session = await getSession(request);
  const error = session.get("error");
  return data(
    {
      configured: oauthConfigured,
      signedIn: !!(await getUserId(request)),
      error,
    },
    { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } },
  );
}

export default function Welcome({ loaderData }: Route.ComponentProps) {
  const { configured, signedIn, error } = loaderData;
  return (
    <main className="flex min-h-full items-center justify-center bg-gradient-to-b from-accent-50/60 to-white p-6 pt-[calc(1.5rem+env(safe-area-inset-top))] dark:from-zinc-900 dark:to-zinc-950">
      <div className="w-full max-w-md">
        {signedIn && (
          <Link
            to="/mail/all/inbox"
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
          {!signedIn && (
            // Google compares this name with the app name on the OAuth consent screen.
            <p className="mt-2 text-sm text-zinc-500">mail by samayo shows your Gmail and Outlook in one inbox.</p>
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

          {configured.hosted && (
            <details className="group mt-4 text-sm">
              <summary className="cursor-pointer list-none text-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                Use a hosted address
              </summary>
              <Form method="post" action="/connect/hosted" className="mt-3 flex flex-col gap-2">
                <input name="email" type="email" required placeholder="Address" autoComplete="username" className={inputClass} />
                <input
                  name="password"
                  type="password"
                  required
                  placeholder="Hosted mail password"
                  autoComplete="current-password"
                  className={inputClass}
                />
                <button className="flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 font-medium press hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                  <EnvelopeSimple className="size-4" /> Connect
                </button>
              </Form>
            </details>
          )}

        </div>
        <LegalLinks className="mt-6" />
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
