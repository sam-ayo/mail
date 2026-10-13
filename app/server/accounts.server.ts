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

export async function userExists(id: string) {
  return !!(await queryOne("SELECT 1 FROM users WHERE id = $1", [id]));
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

export async function deleteAccount(userId: string, accountId: string) {
  await query("DELETE FROM accounts WHERE user_id = $1 AND id = $2", [userId, accountId]);
}
