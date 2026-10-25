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
import { MAIL_SCOPES, type MailScope } from "~/lib/agents";
import { MCP_RESOURCE } from "./agent-connections.server";
import { env } from "./env.server";

/**
 * OAuth 2.1 authorization server for AI agents (MCP clients). Better Auth
 * issues the tokens. It has its own user for each workspace, with the same ID.
 * A workspace has no password, so the login page signs in to Better Auth with
 * the browser's mail session (see `routes/oauth.login.tsx`).
 */

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
