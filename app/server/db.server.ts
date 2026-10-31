import { Pool } from "pg";
import { env } from "./env.server";
import { supabaseRootCa } from "./supabase-ca.server";

// Supabase Postgres through the Supavisor transaction pooler (port 6543). The schema is in `migrations/`.
// Each server instance keeps a few connections. The pooler shares the real database connections.
export const pool = new Pool({ ...connectionConfig(env.databaseUrl), max: 5, idleTimeoutMillis: 10_000 });

// The Supabase certificates come from the Supabase CA, which Node.js does not trust. pg copies
// `sslmode` from the URL over the `ssl` option, so the URL must not have it for Supabase hosts.
function connectionConfig(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (!url.hostname.endsWith(".supabase.com")) return { connectionString: databaseUrl };
  url.searchParams.delete("sslmode");
  return { connectionString: url.toString(), ssl: { ca: supabaseRootCa } };
}
// An idle connection can break. With no listener, the error stops the Node.js process
// and all the requests in it. The pool opens a new connection for the next query.
pool.on("error", (error: Error) => console.error("Database pool:", error));

export async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, params)).rows as T[];
}

export async function queryOne<T>(text: string, params: unknown[] = []) {
  const [row] = await query<T>(text, params);
  return row as T | undefined;
}
