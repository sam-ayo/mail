import { createHash, timingSafeEqual } from "node:crypto";
import { data, Form, redirect } from "react-router";
import { Logo, inputClass } from "~/components/ui";
import { redirectWithError } from "~/server/auth.server";
import { createReviewWorkspace } from "~/server/demo-accounts.server";
import { env } from "~/server/env.server";
import { getSession, sessionStorage } from "~/server/session.server";
import type { Route } from "./+types/review";

/**
 * The sign-in for directory reviewers of Claude and ChatGPT. The review
 * password gives a new workspace with three demo accounts of sample mail.
 * REVIEW_PASSWORD turns it on.
 */

export const meta: Route.MetaFunction = () => [
  { title: "Reviewer sign-in · mail by samayo" },
  { name: "robots", content: "noindex" },
];

/** Only a path on this site, so that the sign-in cannot send the browser to another site. */
function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/mail";
}

export async function loader({ request }: Route.LoaderArgs) {
  if (!env.reviewPassword) throw new Response("Not found", { status: 404 });
  const session = await getSession(request);
  const error = session.get("error");
  return data(
    { error, returnTo: safeReturnTo(new URL(request.url).searchParams.get("returnTo")) },
    { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } },
  );
}

export async function action({ request }: Route.ActionArgs) {
  if (!env.reviewPassword) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const returnTo = safeReturnTo(String(form.get("returnTo") ?? ""));
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(String(form.get("password") ?? "")), digest(env.reviewPassword))) {
    const session = await getSession(request);
    return redirectWithError(session, `/review?returnTo=${encodeURIComponent(returnTo)}`, "The password is not correct.");
  }

  // A new session, not the session of this browser: connectAccount would join
  // a signed-in workspace to the review workspace.
  const session = await sessionStorage.getSession();
  session.set("userId", await createReviewWorkspace());
  return redirect(returnTo, { headers: { "Set-Cookie": await sessionStorage.commitSession(session) } });
}

export default function Review({ loaderData }: Route.ComponentProps) {
  const { error, returnTo } = loaderData;
  return (
    <main className="flex min-h-full items-center justify-center bg-gradient-to-b from-accent-50/60 to-white p-6 dark:from-zinc-900 dark:to-zinc-950">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900">
        <Logo className="text-lg" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Reviewer sign-in</h1>
        <p className="mt-2 text-sm text-zinc-500">
          For reviewers of the Claude and ChatGPT directories. The review password opens a new workspace with three
          accounts of sample mail. Mail that you send from these accounts goes only to their Sent folder.
        </p>
        {error && (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
          >
            {error}
          </p>
        )}
        <Form method="post" className="mt-6 flex flex-col gap-2">
          <input type="hidden" name="returnTo" value={returnTo} />
          <input
            name="password"
            type="password"
            required
            placeholder="Review password"
            autoComplete="current-password"
            className={inputClass}
          />
          <button className="flex h-10 items-center justify-center rounded-xl bg-accent-600 font-medium text-white press hover:bg-accent-700">
            Sign in
          </button>
        </Form>
      </div>
    </main>
  );
}
