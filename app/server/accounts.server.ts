import { randomUUID } from "node:crypto";
import type { AccountStatus, AccountSummary, ProviderKind } from "~/lib/mail";
import { ACCOUNT_COLORS } from "~/lib/mail";
import { decrypt, encrypt } from "./crypto.server";
import { query, queryOne } from "./db.server";
import { composioDisconnect, isComposioCredentials, type ComposioCredentials } from "./oauth/composio.server";

export interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch milliseconds
}

export interface ServerSettings {
  host: string;
  port: number;
  secure: boolean;
}

export interface ImapCredentials {
  user: string;
  password: string;
  imap: ServerSettings;
  smtp: ServerSettings;
}

export interface DemoCredentials {
  persona?: number;
  look?: ProviderKind;
}

export type Credentials = OAuthCredentials | ComposioCredentials | ImapCredentials | DemoCredentials;

export interface Account extends AccountSummary {
  userId: string;
  credentials: Credentials;
}

interface AccountRow {
  id: string;
  user_id: string;
  provider: ProviderKind;
  email: string;
  name: string;
  color: string;
  credentials: string;
  status: AccountStatus;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    email: row.email,
    name: row.name,
    color: row.color,
    status: row.status,
    credentials: JSON.parse(decrypt(row.credentials)),
  };
}

export function toSummary(account: Account): AccountSummary {
  const { id, provider, email, name, color, status } = account;
  const look = provider === "demo" ? (account.credentials as DemoCredentials).look : undefined;
  return { id, provider, email, name, color, status, ...(look && { look }) };
}

export async function createUser({ demo = false } = {}) {
  const id = randomUUID();
  await query("INSERT INTO users (id, demo) VALUES ($1, $2)", [id, demo]);
  return id;
}

/** True for a workspace of the public demo or of the reviewer sign-in. */
export async function isDemoUser(id: string) {
  const row = await queryOne<{ demo: boolean }>("SELECT demo FROM users WHERE id = $1", [id]);
  return row?.demo ?? false;
}

/**
 * Deletes the demo workspaces that are older than a week. A workspace with a
 * real mailbox stays. The Better Auth user of a workspace goes too, with its
 * agent consents and tokens.
 */
export async function deleteExpiredDemoUsers() {
  const rows = await query<{ id: string }>(
    `DELETE FROM users u WHERE u.demo AND u.created_at < now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.user_id = u.id AND a.provider <> 'demo')
     RETURNING u.id`,
  );
  // The Better Auth tables have no foreign key to users. Also delete the
  // Better Auth users that an earlier run left.
  await query("DELETE FROM auth_users a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.id)");
  return rows.length;
}

/**
 * Gives the workspace for a session's user ID. A merged workspace gives the
 * workspace that it joined. An unknown ID gives undefined.
 */
export async function resolveUser(id: string | undefined) {
  if (!id) return undefined;
  const row = await queryOne<{ id: string }>(
    "SELECT COALESCE(merged_into, id) AS id FROM users WHERE id = $1",
    [id],
  );
  return row?.id;
}

/**
 * Resolves the user as resolveUser does. The same query gives the user's
 * accounts and the demo flag of isDemoUser. Each page load needs all three,
 * and each query is a round trip.
 */
export async function resolveUserAccounts(id: string | undefined) {
  if (!id) return undefined;
  const rows = await query<{ resolved_id: string; user_demo: boolean } & Partial<AccountRow>>(
    `SELECT r.id AS resolved_id, r.demo AS user_demo, a.*
     FROM users s
     JOIN users r ON r.id = COALESCE(s.merged_into, s.id)
     LEFT JOIN accounts a ON a.user_id = r.id
     WHERE s.id = $1
     ORDER BY a.position, a.created_at`,
    [id],
  );
  if (rows.length === 0) return undefined;
  // A user with no accounts gives one row with no account columns.
  const accounts = rows.filter((row) => row.id).map((row) => toAccount(row as AccountRow));
  return { id: rows[0].resolved_id, demo: rows[0].user_demo, accounts };
}

export async function listAccounts(userId: string): Promise<Account[]> {
  const rows = await query<AccountRow>(
    "SELECT * FROM accounts WHERE user_id = $1 ORDER BY position, created_at",
    [userId],
  );
  return rows.map(toAccount);
}

export async function getAccount(userId: string, accountId: string): Promise<Account | undefined> {
  const row = await queryOne<AccountRow>(
    "SELECT * FROM accounts WHERE user_id = $1 AND id = $2",
    [userId, accountId],
  );
  return row ? toAccount(row) : undefined;
}

export async function findAccountOwner(provider: ProviderKind, email: string) {
  const row = await queryOne<{ user_id: string }>(
    "SELECT user_id FROM accounts WHERE provider = $1 AND email = $2",
    [provider, email.toLowerCase()],
  );
  return row?.user_id;
}

/**
 * The workspaces that have the mailbox, and if the mailbox is a sign-in
 * account of each. Only a sign-in account opens its workspace in a new
 * browser. A shared mailbox, for example a team address, can be in the
 * workspace of each person who uses it.
 */
export async function findAccountWorkspaces(provider: ProviderKind, email: string) {
  const rows = await query<{ user_id: string; can_sign_in: boolean }>(
    "SELECT user_id, can_sign_in FROM accounts WHERE provider = $1 AND email = $2 ORDER BY created_at",
    [provider, email.toLowerCase()],
  );
  return rows.map((row) => ({ userId: row.user_id, canSignIn: row.can_sign_in }));
}

/**
 * Inserts the account in the workspace, or refreshes its credentials if the
 * workspace has it. Other workspaces that have the same mailbox keep their
 * own account and credentials.
 */
export async function upsertAccount(input: {
  userId: string;
  provider: ProviderKind;
  email: string;
  name: string;
  credentials: Credentials;
  /** For a new account only: the account can open the workspace in a new browser. */
  canSignIn?: boolean;
}): Promise<string> {
  const email = input.email.toLowerCase();
  const credentials = encrypt(JSON.stringify(input.credentials));
  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM accounts WHERE user_id = $1 AND provider = $2 AND email = $3",
    [input.userId, input.provider, email],
  );

  if (existing) {
    await query(
      `UPDATE accounts SET name = $1, credentials = $2, status = 'active'
       WHERE id = $3`,
      [input.name, credentials, existing.id],
    );
    return existing.id;
  }
  return insertAccount({ ...input, email });
}

/** Adds the account to the workspace. Demo addresses can be in more than one workspace. */
export async function insertAccount(input: {
  userId: string;
  provider: ProviderKind;
  email: string;
  name: string;
  credentials: Credentials;
  canSignIn?: boolean;
}): Promise<string> {
  const email = input.email.toLowerCase();
  const credentials = encrypt(JSON.stringify(input.credentials));
  const { count } = (await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM accounts WHERE user_id = $1",
    [input.userId],
  ))!;
  const id = randomUUID();
  await query(
    `INSERT INTO accounts (id, user_id, provider, email, name, color, credentials, position, can_sign_in)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      input.userId,
      input.provider,
      email,
      input.name,
      ACCOUNT_COLORS[count % ACCOUNT_COLORS.length],
      credentials,
      count,
      input.canSignIn ?? false,
    ],
  );
  return id;
}

export async function updateCredentials(accountId: string, credentials: Credentials) {
  await query("UPDATE accounts SET credentials = $1, status = 'active' WHERE id = $2", [
    encrypt(JSON.stringify(credentials)),
    accountId,
  ]);
}

export async function setAccountStatus(accountId: string, status: AccountStatus) {
  await query("UPDATE accounts SET status = $1 WHERE id = $2", [status, accountId]);
}

export async function updateAccountProfile(
  userId: string,
  accountId: string,
  profile: { name?: string; color?: string },
) {
  const account = await getAccount(userId, accountId);
  if (!account) return;
  await query("UPDATE accounts SET name = $1, color = $2 WHERE id = $3", [
    profile.name ?? account.name,
    profile.color ?? account.color,
    accountId,
  ]);
}

/** The most colors that a person can add. When a person adds more, the oldest color goes. */
const MAX_CUSTOM_COLORS = 16;

/** The colors that the person added to the default colors, oldest first. */
export async function listCustomColors(userId: string): Promise<string[]> {
  const row = await queryOne<{ custom_colors: string[] }>("SELECT custom_colors FROM users WHERE id = $1", [userId]);
  return row?.custom_colors ?? [];
}

/** Adds a color to the colors of the person. A default color or a color that is in the list does not change it. */
export async function addCustomColor(userId: string, color: string) {
  if (ACCOUNT_COLORS.includes(color)) return;
  await query(
    `UPDATE users
     SET custom_colors = (array_append(custom_colors, $2::text))[greatest(1, cardinality(custom_colors) + 2 - $3):]
     WHERE id = $1 AND NOT ($2 = ANY(custom_colors))`,
    [userId, color, MAX_CUSTOM_COLORS],
  );
}

/** Removes a color from the colors of the person. The accounts that have the color keep it. */
export async function removeCustomColor(userId: string, color: string) {
  await query("UPDATE users SET custom_colors = array_remove(custom_colors, $2) WHERE id = $1", [userId, color]);
}

export async function deleteAccount(userId: string, accountId: string) {
  const rows = await query<{ credentials: string }>(
    "DELETE FROM accounts WHERE user_id = $1 AND id = $2 RETURNING credentials",
    [userId, accountId],
  );
  // A Gmail account that Composio connected also leaves Composio.
  for (const row of rows) {
    const credentials: unknown = JSON.parse(decrypt(row.credentials));
    if (isComposioCredentials(credentials)) await composioDisconnect(credentials);
  }
}
