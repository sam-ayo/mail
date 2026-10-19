import { requireMcpAuth } from "@better-auth/mcp";
import { MAIL_SCOPES } from "~/lib/agents";
import { agentAuth, hasConsent, MCP_RESOURCE } from "~/server/agent-auth.server";
import { env } from "~/server/env.server";
import { mcpHandler } from "~/server/mcp.server";
import type { Route } from "./+types/mcp";

// The MCP endpoint. A request needs an access token from the OAuth server in
// agent-auth.server.ts. The token's subject is the workspace ID.
const handle = requireMcpAuth(
  agentAuth,
  async (request, claims) => {
    const clientId = String(claims.azp ?? "");
    if (!claims.sub || !(await hasConsent(claims.sub, clientId))) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "The user disconnected this agent" }, id: null },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${env.appUrl}/.well-known/oauth-protected-resource/mcp"`,
          },
        },
      );
    }
    return mcpHandler.fetch(request, {
      authInfo: {
        token: request.headers.get("authorization")?.replace(/^(Bearer|DPoP) /i, "") ?? "",
        clientId,
        scopes: typeof claims.scope === "string" ? claims.scope.split(" ") : [],
        expiresAt: claims.exp,
        resource: new URL(MCP_RESOURCE),
        extra: { userId: claims.sub },
      },
    });
  },
  {
    resource: MCP_RESOURCE,
    // Agents ask for these scopes when they connect. offline_access gives a refresh token.
    challengeScopes: ["offline_access", ...Object.keys(MAIL_SCOPES)],
  },
);

export const loader = ({ request }: Route.LoaderArgs) => handle(request);
export const action = ({ request }: Route.ActionArgs) => handle(request);
