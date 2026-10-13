import { neon } from "@neondatabase/serverless";
import { env } from "./env.server";

// Neon Postgres over HTTP. The schema is in `migrations/`.
const sql = neon(env.databaseUrl);

export async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql.query(text, params)) as T[];
}

export async function queryOne<T>(text: string, params: unknown[] = []) {
  const [row] = await query<T>(text, params);
  return row as T | undefined;
}
