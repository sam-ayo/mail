import { env } from "../env.server";
import { randomToken } from "../crypto.server";
import { ProviderAuthError, ProviderError } from "../providers/types";

// Composio connects Gmail with its own verified Google app. The app never
// gets the Google tokens: Composio keeps them, refreshes them, and adds them
// to each Gmail API request that goes through its proxy.
const API = "https://backend.composio.dev/api/v3.1";

/** The credentials of a Gmail account that Composio connected. */
export interface ComposioCredentials {
  composioAccountId: string;
  composioUserId: string;
}

export function isComposioCredentials(value: unknown): value is ComposioCredentials {
  return typeof value === "object" && value !== null && "composioAccountId" in value;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "x-api-key": env.composio.apiKey, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } | string };
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    throw new ProviderError(`Composio error ${response.status}: ${message ?? response.statusText}`, response.status);
  }
  return (await response.json()) as T;
}

/** Starts a Gmail connection. The user goes to redirectUrl, then back to callbackUrl. */
export async function composioStartGmail(callbackUrl: string) {
  const userId = `mail-${randomToken(16)}`;
  const session = await call<{ session_id: string }>("/tool_router/session", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, toolkits: { enable: ["gmail"] } }),
  });
  const link = await call<{ redirect_url: string; connected_account_id: string }>(
    `/tool_router/session/${encodeURIComponent(session.session_id)}/link`,
    { method: "POST", body: JSON.stringify({ toolkit: "gmail", callback_url: callbackUrl }) },
  );
  return { redirectUrl: link.redirect_url, composioAccountId: link.connected_account_id, composioUserId: userId };
}

interface ProxyResponse {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
}

/** Sends one Gmail API request through the Composio proxy. */
export async function composioProxy(
  credentials: ComposioCredentials,
  url: string,
  init: { method?: string; body?: string } = {},
): Promise<ProxyResponse> {
  try {
    return await call<ProxyResponse>("/tools/execute/proxy", {
      method: "POST",
      body: JSON.stringify({
        connected_account_id: credentials.composioAccountId,
        user_id: credentials.composioUserId,
        endpoint: url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body) : undefined,
      }),
    });
  } catch (error) {
    // Composio answers 4xx when the connection expired or the user removed access.
    if (error instanceof ProviderError && (error.status === 401 || error.status === 403 || error.status === 404)) {
      throw new ProviderAuthError();
    }
    throw error;
  }
}

/** Checks that the connection is active, and returns the Gmail address. */
export async function composioFinishGmail(credentials: ComposioCredentials) {
  const account = await call<{ status: string; toolkit?: { slug?: string } }>(
    `/connected_accounts/${encodeURIComponent(credentials.composioAccountId)}`,
  );
  if (account.status !== "ACTIVE" || account.toolkit?.slug !== "gmail") {
    throw new Error("Gmail did not connect. Try again.");
  }
  const profile = await composioProxy(credentials, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
  const email = (profile.data as { emailAddress?: string } | null)?.emailAddress;
  if (profile.status !== 200 || !email) throw new Error("Could not read the Gmail address. Try again.");
  return { email, name: "", credentials };
}

/** Removes the connection from Composio, and revokes its access to Gmail. */
export async function composioDisconnect(credentials: ComposioCredentials) {
  await call(`/connected_accounts/${encodeURIComponent(credentials.composioAccountId)}?revoke_on_delete=true`, {
    method: "DELETE",
  }).catch(() => undefined);
}
