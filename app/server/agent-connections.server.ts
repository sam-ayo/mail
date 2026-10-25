import { isMailScope, type MailScope } from "~/lib/agents";
import { query, queryOne } from "./db.server";
import { env } from "./env.server";

/**
 * The agents that a workspace allowed. These functions read the Better Auth
 * tables with SQL. They do not import the Better Auth instance, which
 * connects to the database when it loads. The build loads the MCP server.
 */

export const MCP_RESOURCE = `${env.appUrl}/mcp`;

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
