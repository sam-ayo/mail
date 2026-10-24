import { randomUUID } from "node:crypto";
import type { AccountStatus, AccountSummary, ProviderKind } from "~/lib/mail";
import { ACCOUNT_COLORS } from "~/lib/mail";
import { decrypt, encrypt } from "./crypto.server";
import { query, queryOne } from "./db.server";

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

export type Credentials = OAuthCredentials | ImapCredentials | DemoCredentials;

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

export async function createUser() {
  const id = randomUUID();
  await query("INSERT INTO users (id) VALUES ($1)", [id]);
  return id;
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
 * Moves the accounts and devices of one workspace into another. This occurs
 * when a browser connects a mailbox that another workspace has. Before, the
 * mailbox moved, and the other browser lost it.
 */
export async function mergeUsers(from: string, into: string) {
  const { count } = (await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM accounts WHERE user_id = $1",
    [into],
  ))!;
  await query("UPDATE accounts SET user_id = $1, position = position + $2 WHERE user_id = $3", [
    into,
    count,
    from,
  ]);
  await query("UPDATE push_subscriptions SET user_id = $1 WHERE user_id = $2", [into, from]);
  // The added colors of the two workspaces join, in their order and without duplicates.
  await query(
    `UPDATE users SET custom_colors = ARRAY(
       SELECT color FROM unnest(custom_colors || (SELECT custom_colors FROM users WHERE id = $2))
         WITH ORDINALITY AS added(color, position)
       GROUP BY color ORDER BY min(position)
     ) WHERE id = $1`,
    [into, from],
  );
  await query("UPDATE users SET merged_into = $1 WHERE id = $2 OR merged_into = $2", [into, from]);
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
 * Inserts the account, or refreshes its credentials if it exists. A person who
 * signs in to a mailbox proves that they own it, so the account moves to the
 * current user.
 */
export async function upsertAccount(input: {
  userId: string;
  provider: ProviderKind;
  email: string;
  name: string;
  credentials: Credentials;
}): Promise<string> {
  const email = input.email.toLowerCase();
  const credentials = encrypt(JSON.stringify(input.credentials));
  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM accounts WHERE provider = $1 AND email = $2",
    [input.provider, email],
  );

  if (existing) {
    await query(
      `UPDATE accounts SET user_id = $1, name = $2, credentials = $3, status = 'active'
       WHERE id = $4`,
      [input.userId, input.name, credentials, existing.id],
    );
    return existing.id;
  }

  const { count } = (await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM accounts WHERE user_id = $1",
    [input.userId],
  ))!;
  const id = randomUUID();
  await query(
    `INSERT INTO accounts (id, user_id, provider, email, name, color, credentials, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      input.userId,
      input.provider,
      email,
      input.name,
      ACCOUNT_COLORS[count % ACCOUNT_COLORS.length],
      credentials,
      count,
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
  await query("DELETE FROM accounts WHERE user_id = $1 AND id = $2", [userId, accountId]);
}
