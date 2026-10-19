import { createHmac } from "node:crypto";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { Pool } from "@neondatabase/serverless";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { jwt } from "better-auth/plugins";
import * as z from "zod";
import { isMailScope, MAIL_SCOPES, type MailScope } from "~/lib/agents";
import { query, queryOne } from "./db.server";
import { env } from "./env.server";

/**
 * OAuth 2.1 authorization server for AI agents (MCP clients). Better Auth
 * issues the tokens. It has its own user for each workspace, with the same ID.
 * A workspace has no password, so the login page signs in to Better Auth with
 * the browser's mail session (see `routes/oauth.login.tsx`).
 */

export const MCP_RESOURCE = `${env.appUrl}/mcp`;


/** Starts a Better Auth session for a workspace. Only the server can call it. */
const workspaceSignIn = () =>
  ({
    id: "workspace-sign-in",
    endpoints: {
      workspaceSignIn: createAuthEndpoint(
        "/workspace/sign-in",
        {
          method: "POST",
          body: z.object({ workspaceId: z.string() }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          const { workspaceId } = ctx.body;
          const adapter = ctx.context.internalAdapter;
          const user =
            (await adapter.findUserById(workspaceId)) ??
            (await adapter.createUser(
              { id: workspaceId, name: "Workspace", email: `${workspaceId}@workspace.invalid` },
              { method: "workspace" },
            ));
          const session = await adapter.createSession(user.id, true);
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR");
          await setSessionCookie(ctx, { session, user }, true);
          return ctx.json({ ok: true });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;

export const agentAuth = betterAuth({
  appName: "mail",
  baseURL: env.appUrl,
  basePath: "/api/auth",
  // A separate key, so that the mail session secret signs only mail sessions.
  secret: createHmac("sha256", env.sessionSecret).update("better-auth").digest("base64url"),
  database: new Pool({ connectionString: env.databaseUrl }),
  user: { modelName: "auth_users" },
  // Sessions exist only for the sign-in and consent steps of an OAuth flow.
  session: { modelName: "auth_sessions", expiresIn: 60 * 60 },
  account: { modelName: "auth_accounts" },
  verification: { modelName: "auth_verifications" },
  advanced: {
    cookiePrefix: "agent-auth",
  },
  plugins: [
    jwt({ schema: { jwks: { modelName: "auth_jwks" } } }),
    mcp({
      loginPage: "/oauth/login",
      consentPage: "/oauth/consent",
      resource: MCP_RESOURCE,
      scopes: ["offline_access", ...(Object.keys(MAIL_SCOPES) as MailScope[])],
      // Each token acts for a person, so the client credentials grant is off.
      grantTypes: ["authorization_code", "refresh_token"],
      // Clients that do not support Client ID Metadata Documents yet register
      // with RFC 7591. The deprecated method is open, as the MCP spec expects.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // One hour. The refresh token renews it.
      accessTokenExpiresIn: 60 * 60,
      // 90 days, the same as a mail session.
      refreshTokenExpiresIn: 60 * 60 * 24 * 90,
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    workspaceSignIn(),
  ],
});

// The Better Auth users of a workspace: its own ID, and the IDs of the
// workspaces that joined it. A token keeps the ID that it was issued for.
const WORKSPACE_USERS = "SELECT id FROM users WHERE id = $1 OR merged_into = $1";

export interface AgentConnection {
  clientId: string;
  name: string;
  site?: string;
  scopes: MailScope[];
  connectedAt: string;
}

/** The agents that the person allowed, newest first. */
export async function listAgentConnections(workspaceId: string): Promise<AgentConnection[]> {
  const rows = await query<{ clientId: string; name: string | null; uri: string | null; scopes: string[]; createdAt: Date }>(
    `SELECT c."clientId", cl.name, cl.uri, c.scopes, c."createdAt"
     FROM "oauthConsent" c JOIN "oauthClient" cl ON cl."clientId" = c."clientId"
     WHERE c."userId" IN (${WORKSPACE_USERS})
     ORDER BY c."createdAt" DESC`,
    [workspaceId],
  );
  return rows.map((row) => ({
    clientId: row.clientId,
    name: row.name || "AI agent",
    site: hostOf(row.uri) ?? hostOf(row.clientId),
    scopes: row.scopes.filter(isMailScope),
    connectedAt: new Date(row.createdAt).toISOString(),
  }));
}

/** Removes the consent and revokes the refresh tokens. The MCP route rejects the access tokens at once. */
export async function disconnectAgent(workspaceId: string, clientId: string) {
  await query(`DELETE FROM "oauthConsent" WHERE "clientId" = $2 AND "userId" IN (${WORKSPACE_USERS})`, [
    workspaceId,
    clientId,
  ]);
  await query(
    `UPDATE "oauthRefreshToken" SET revoked = now()
     WHERE "clientId" = $2 AND revoked IS NULL AND "userId" IN (${WORKSPACE_USERS})`,
    [workspaceId, clientId],
  );
}

/** A JWT access token is valid until it expires. This check makes a disconnect take effect at once. */
export async function hasConsent(userId: string, clientId: string) {
  return !!(await queryOne(`SELECT 1 FROM "oauthConsent" WHERE "userId" = $1 AND "clientId" = $2`, [
    userId,
    clientId,
  ]));
}

function hostOf(uri: string | null | undefined) {
  try {
    return uri ? new URL(uri).host : undefined;
  } catch {
    return undefined;
  }
}
