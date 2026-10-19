import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { agentAuth } from "~/server/agent-auth.server";
import type { Route } from "./+types/well-known";

const authServerMetadata = oauthProviderAuthServerMetadata(agentAuth);

/**
 * OAuth discovery documents at the root of the host, where MCP clients look
 * for them. RFC 8414 and RFC 9728 put the issuer path ("/api/auth") or the
 * resource path ("/mcp") after the well-known name.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const path = params["*"];
  if (path === "oauth-authorization-server/api/auth") return authServerMetadata(request);
  // The MCP plugin serves the protected resource metadata at the root paths.
  if (path === "oauth-protected-resource" || path === "oauth-protected-resource/mcp") {
    return agentAuth.handler(request);
  }
  throw new Response("Not Found", { status: 404 });
}
