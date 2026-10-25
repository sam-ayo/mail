import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolveUser } from "./accounts.server";
import { query, queryOne } from "./db.server";

// Personal API tokens. The AI sorting script on the person's computer sends
// one in the Authorization header. Only the hash of a token stays in the database.

const PREFIX = "relay_";
const MAX_TOKENS = 10;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export interface ApiToken {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listApiTokens(userId: string): Promise<ApiToken[]> {
  const rows = await query<{ id: string; name: string; created_at: Date; last_used_at: Date | null }>(
    "SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = $1 ORDER BY created_at",
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  }));
}

/** Makes a token. The person sees it only once. */
export async function createApiToken(userId: string, name: string) {
  const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO api_tokens (id, user_id, name, token_hash)
     SELECT $1, $2, $3, $4
     WHERE (SELECT COUNT(*) FROM api_tokens WHERE user_id = $2) < $5
     RETURNING id`,
    [randomUUID(), userId, name.trim().slice(0, 100) || "API token", hash(token), MAX_TOKENS],
  );
  if (!row) throw new Error(`A workspace can have ${MAX_TOKENS} tokens. Delete a token first.`);
  return token;
}

export async function deleteApiToken(userId: string, id: string) {
  await query("DELETE FROM api_tokens WHERE user_id = $1 AND id = $2", [userId, id]);
}

/** The workspace of the Bearer token in the request. Throws a 401 response if the token is not valid. */
export async function requireApiTokenUser(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const row = token.startsWith(PREFIX)
    ? await queryOne<{ user_id: string }>(
        "UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING user_id",
        [hash(token)],
      )
    : undefined;
  // A merged workspace gives the workspace that it joined.
  const userId = await resolveUser(row?.user_id);
  if (!userId) throw new Response("Unauthorized", { status: 401 });
  return userId;
}
