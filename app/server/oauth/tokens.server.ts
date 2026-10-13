import type { Account, OAuthCredentials } from "../accounts.server";
import { setAccountStatus, updateCredentials } from "../accounts.server";
import { ProviderAuthError } from "../providers/types";
import { googleRefresh } from "./google.server";
import { microsoftRefresh } from "./microsoft.server";

const inFlight = new Map<string, Promise<OAuthCredentials>>();

/**
 * Returns a valid access token. The function refreshes the token one minute
 * before it expires. Parallel callers share one refresh request.
 */
export function createTokenSource(account: Account) {
  let credentials = account.credentials as OAuthCredentials;

  async function refresh() {
    let pending = inFlight.get(account.id);
    if (!pending) {
      const refresher = account.provider === "google" ? googleRefresh : microsoftRefresh;
      pending = refresher(credentials)
        .then(async (next) => {
          await updateCredentials(account.id, next);
          return next;
        })
        .catch(async (error) => {
          if (error instanceof ProviderAuthError) {
            await setAccountStatus(account.id, "reauth_required");
          }
          throw error;
        })
        .finally(() => inFlight.delete(account.id));
      inFlight.set(account.id, pending);
    }
    credentials = await pending;
    return credentials.accessToken;
  }

  return {
    async get() {
      if (credentials.expiresAt - Date.now() > 60_000) return credentials.accessToken;
      return refresh();
    },
    /** Call after the provider rejects a token that looked valid. */
    refresh,
  };
}

export type TokenSource = ReturnType<typeof createTokenSource>;
