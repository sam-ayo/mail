import { Keyboard, MagnifyingGlass, Sparkle, Tray } from "~/components/icons";
import { Form, Link, redirect } from "react-router";
import { LegalLinks } from "~/components/legal";
import { Logo } from "~/components/ui";
import { DEMO_COMPANY, DEMO_COMPANY_LOGO_URL } from "~/lib/demo-company";
import { isDemoUser } from "~/server/accounts.server";
import { getUserId } from "~/server/auth.server";
import { createDemoWorkspace, isDemoHost } from "~/server/demo-accounts.server";
import { env } from "~/server/env.server";
import { sessionStorage } from "~/server/session.server";
import type { Route } from "./+types/demo";

/**
 * The public demo. Each visitor gets a new workspace with three accounts of
 * sample mail. demo.samayo.me opens this page.
 */

const TITLE = "Try mail by samayo";
const DESCRIPTION =
  "A live demo of mail by samayo, an email client with one fast inbox for all your accounts. No sign-in.";

export const meta: Route.MetaFunction = () => [
  { title: `${TITLE} · Live demo` },
  { name: "description", content: DESCRIPTION },
  { property: "og:title", content: TITLE },
  { property: "og:description", content: DESCRIPTION },
  { property: "og:type", content: "website" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getUserId(request);
  return {
    // A visitor who has a demo workspace can open it again.
    hasDemo: !!userId && (await isDemoUser(userId)),
    // On the demo host, OAuth sign-in does not work. Real accounts connect on the app's own host.
    realAppUrl: isDemoHost(request) ? `${env.appUrl}/welcome` : "/welcome",
  };
}

export async function action() {
  // A new session, not the session of this browser: a demo never joins a real workspace.
  const session = await sessionStorage.getSession();
  session.set("userId", await createDemoWorkspace());
  return redirect("/mail/all/inbox", { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } });
}

const FEATURES = [
  { icon: Tray, text: "A work, a Gmail, and an Outlook account in one unified inbox" },
  { icon: Keyboard, text: "Keyboard shortcuts for all actions. Push ? to see them." },
  { icon: MagnifyingGlass, text: "Search, and a command palette on ⌘K" },
];

export default function Demo({ loaderData }: Route.ComponentProps) {
  const { hasDemo, realAppUrl } = loaderData;
  return (
    <main className="flex min-h-full items-center justify-center bg-gradient-to-b from-accent-50/60 to-white p-6 pt-[calc(1.5rem+env(safe-area-inset-top))] dark:from-zinc-900 dark:to-zinc-950">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <Logo className="text-lg" />
            <span className="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 dark:bg-accent-950 dark:text-accent-300">
              Live demo
            </span>
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">{TITLE}</h1>
          <p className="mt-2 text-sm text-zinc-500">
            You get your own workspace at {DEMO_COMPANY.name}, a sample company, with sample mail. Read, reply, archive,
            and sort as you like. No sign-in.
          </p>

          <ul className="mt-5 space-y-2.5 text-sm text-zinc-700 dark:text-zinc-300">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5">
                <Icon className="mt-0.5 size-4 shrink-0 text-accent-600 dark:text-accent-400" />
                {text}
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-col gap-2">
            {hasDemo && (
              <Link
                to="/mail/all/inbox"
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-accent-600 text-sm font-medium text-white press hover:bg-accent-700"
              >
                <img src={DEMO_COMPANY_LOGO_URL} alt="" className="size-5 rounded-[5px]" /> Open my demo workspace
              </Link>
            )}
            <Form method="post">
              <button
                className={
                  hasDemo
                    ? "flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 text-sm font-medium press hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    : "flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent-600 text-sm font-medium text-white press hover:bg-accent-700"
                }
              >
                <Sparkle className="size-4" /> {hasDemo ? "Start a new demo" : "Open the demo"}
              </button>
            </Form>
          </div>

          <p className="mt-5 text-xs text-zinc-400">
            Demo accounts send no mail. A message that you send goes only to the Sent folder. We delete each demo
            workspace after a week.
          </p>
        </div>
        <p className="mt-6 text-center text-sm text-zinc-500">
          Want your own inbox?{" "}
          <a href={realAppUrl} className="font-medium text-accent-600 hover:underline dark:text-accent-400">
            Connect Gmail or Outlook
          </a>
        </p>
        <LegalLinks className="mt-3" />
      </div>
    </main>
  );
}
