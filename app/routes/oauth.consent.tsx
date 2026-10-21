import { Form, redirect } from "react-router";
import { AccountIcon, Button, Logo } from "~/components/ui";
import { isMailScope, MAIL_SCOPES } from "~/lib/agents";
import { agentAuth } from "~/server/agent-auth.server";
import { listAccounts, resolveUser, toSummary } from "~/server/accounts.server";
import { env } from "~/server/env.server";
import type { Route } from "./+types/oauth.consent";

export const meta: Route.MetaFunction = () => [{ title: "Allow access · mail by samayo" }];

// Another site must not show this page in a frame and trick a click on Allow.
export const headers: Route.HeadersFunction = () => ({
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
});

/** The consent step of the OAuth flow. Better Auth signs the query, so the page passes it back as is. */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const session = await agentAuth.api.getSession({ headers: request.headers });
  const clientId = url.searchParams.get("client_id");
  if (!session || !clientId) throw new Response("The sign-in request is not valid. Connect the agent again.", { status: 400 });

  const client = await agentAuth.api.getOAuthClientPublic({
    query: { client_id: clientId },
    headers: request.headers,
  });
  const workspaceId = await resolveUser(session.user.id);
  const accounts = workspaceId ? (await listAccounts(workspaceId)).map(toSummary) : [];
  const scopes = (url.searchParams.get("scope") ?? "")
    .split(" ")
    .filter(isMailScope);
  const host = (uri?: string) => {
    try {
      return uri ? new URL(uri).host : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    client: {
      name: client.client_name || host(client.client_uri) || "An AI agent",
      site: host(client.client_uri) ?? host(client.client_id),
      logo: client.logo_uri?.startsWith("https://") ? client.logo_uri : undefined,
    },
    scopes: scopes.map((scope) => MAIL_SCOPES[scope]),
    offline: url.searchParams.get("scope")?.split(" ").includes("offline_access") ?? false,
    accounts,
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (request.headers.get("Origin") !== env.appUrl) throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  // Use the HTTP handler, not agentAuth.api. The consent endpoint runs the
  // authorize step again, and that step needs a request.
  const response = await agentAuth.handler(
    new Request(`${env.appUrl}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: env.appUrl,
        Cookie: request.headers.get("Cookie") ?? "",
      },
      body: JSON.stringify({
        accept: form.get("decision") === "allow",
        oauth_query: new URL(request.url).search.slice(1),
      }),
    }),
  );
  const result = (await response.json()) as { url?: string; error_description?: string };
  if (!result.url) throw new Response(result.error_description ?? "The consent failed", { status: response.status });
  return redirect(result.url);
}

export default function OAuthConsent({ loaderData }: Route.ComponentProps) {
  const { client, scopes, offline, accounts } = loaderData;
  return (
    <main className="flex min-h-full items-center justify-center bg-gradient-to-b from-accent-50/60 to-white p-6 dark:from-zinc-900 dark:to-zinc-950">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <Logo className="text-lg" />
          {client.logo && <img src={client.logo} alt="" className="ml-auto size-8 rounded-lg" />}
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Allow {client.name} to use your email?</h1>
        {client.site && <p className="mt-1 text-sm text-zinc-500">{client.site}</p>}

        <p className="mt-5 text-sm font-medium">The agent can:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
          {scopes.map((scope) => (
            <li key={scope}>{scope}</li>
          ))}
          {offline && <li>Stay connected until you disconnect it in Settings</li>}
        </ul>

        <p className="mt-5 text-sm font-medium">In these accounts:</p>
        <ul className="mt-2 space-y-1.5">
          {accounts.map((account) => (
            <li key={account.id} className="flex items-center gap-2 text-sm">
              <AccountIcon account={account} className="size-5" /> {account.email}
            </li>
          ))}
        </ul>

        <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          An email can contain instructions for the agent. Allow only an agent that you trust, and keep its approval
          settings on for actions that send or delete mail.
        </p>

        <Form method="post" className="mt-6 flex gap-2">
          <Button name="decision" value="deny" className="flex-1">
            Deny
          </Button>
          <Button name="decision" value="allow" variant="primary" className="flex-1">
            Allow
          </Button>
        </Form>
      </div>
    </main>
  );
}
