import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { getAgentAuth } from "~/server/agent-auth.server";
import { env } from "~/server/env.server";
import type { Route } from "./+types/well-known";

let authServerMetadata: ReturnType<typeof oauthProviderAuthServerMetadata> | undefined;

/**
 * OAuth discovery documents at the root of the host, where MCP clients look
 * for them. RFC 8414 and RFC 9728 put the issuer path ("/api/auth") or the
 * resource path ("/mcp") after the well-known name.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const path = params["*"];
  if (path === "oauth-authorization-server/api/auth") {
    authServerMetadata ??= oauthProviderAuthServerMetadata(getAgentAuth());
    return authServerMetadata(request);
  }
  // The MCP plugin serves the protected resource metadata at the root paths.
  if (path === "oauth-protected-resource" || path === "oauth-protected-resource/mcp") {
    return getAgentAuth().handler(request);
  }
  // ChatGPT verifies that the owner of the MCP server owns this domain. The
  // body must be the token alone, as plain text.
  if (path === "openai-apps-challenge" && env.openaiAppsChallenge) {
    return new Response(env.openaiAppsChallenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  throw new Response("Not Found", { status: 404 });
}
