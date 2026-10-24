import webpush from "web-push";
import type { Address, ThreadSummary } from "~/lib/mail";
import { displayName } from "~/lib/mail";
import type { Account } from "./accounts.server";
import { listAccounts } from "./accounts.server";
import { query } from "./db.server";
import { env } from "./env.server";
import { providerFor } from "./mail.server";
import { mapLimit } from "./util.server";

export const pushConfigured = !!(env.push.publicKey && env.push.privateKey);

if (pushConfigured) webpush.setVapidDetails(env.push.subject, env.push.publicKey, env.push.privateKey);

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The service worker shows this payload as a notification. See public/sw.js. */
interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  /** The sender's address. The service worker shows the sender's logo as the icon. */
  sender?: string;
}

/** A thread gets one notification. More new threads than this get one summary notification. */
const MAX_THREAD_NOTIFICATIONS = 3;

export async function saveSubscription(userId: string, subscription: PushSubscriptionInput) {
  await query(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, p256dh = $3, auth = $4`,
    [subscription.endpoint, userId, subscription.keys.p256dh, subscription.keys.auth],
  );
  // Start the mail check again from now. Without this, a person who turns
  // notifications on again gets a notification for each thread since the last check.
  await query(
    "DELETE FROM inbox_checks WHERE account_id IN (SELECT id FROM accounts WHERE user_id = $1)",
    [userId],
  );
}

export async function deleteSubscription(userId: string, endpoint: string) {
  await query("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", [userId, endpoint]);
}

async function sendToUser(userId: string, payloads: PushPayload[]) {
  if (!pushConfigured || payloads.length === 0) return;
  const subscriptions = await query<{ endpoint: string; p256dh: string; auth: string }>(
    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
    [userId],
  );
  await Promise.all(
    subscriptions.flatMap(({ endpoint, p256dh, auth }) =>
      payloads.map(async (payload) => {
        try {
          await webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, JSON.stringify(payload), {
            TTL: 60 * 60 * 24,
          });
        } catch (error) {
          // 404 and 410 tell that the device removed the subscription.
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
          } else {
            console.error("Push failed", status, error);
          }
        }
      }),
    ),
  );
}

type AccountRef = Pick<Account, "id" | "email" | "userId">;

function threadPayloads(account: AccountRef, threads: ThreadSummary[]): PushPayload[] {
  const inbox = `/mail/${account.id}/inbox`;
  if (threads.length > MAX_THREAD_NOTIFICATIONS) {
    return [
      { title: account.email, body: `${threads.length} new messages`, url: inbox, tag: `inbox:${account.id}` },
    ];
  }
  return threads.map((thread) => {
    // The last person in the thread who is not the owner of the account.
    const sender = thread.participants
      .filter((p) => p.email.toLowerCase() !== account.email.toLowerCase())
      .at(-1);
    return {
      title: sender ? displayName(sender) : account.email,
      body: [thread.subject, thread.snippet].filter(Boolean).join("\n"),
      url: `${inbox}/${account.id}/${encodeURIComponent(thread.id)}`,
      tag: `thread:${account.id}:${thread.id}`,
      sender: sender?.email,
    };
  });
}

/** Sends notifications to the owner of the account for new inbox threads. */
export async function notifyNewThreads(account: AccountRef, threads: ThreadSummary[]) {
  await sendToUser(account.userId, threadPayloads(account, threads));
}

/** Sends a notification for a hosted message that came to the inbox. The webhook calls it. */
export async function notifyHostedMessage(mailbox: string, messageId: string) {
  const [message] = await query<{ thread_id: string; subject: string; snippet: string; from_address: Address; date: string }>(
    "SELECT thread_id, subject, snippet, from_address, date FROM hosted_messages WHERE id = $1",
    [messageId],
  );
  if (!message) return;
  const owners = await query<{ id: string; email: string; user_id: string }>(
    "SELECT id, email, user_id FROM accounts WHERE provider = 'hosted' AND email = $1 AND status = 'active'",
    [mailbox.toLowerCase()],
  );
  const thread: ThreadSummary = {
    accountId: "",
    id: message.thread_id,
    subject: message.subject || "(no subject)",
    snippet: message.snippet,
    participants: [message.from_address],
    date: new Date(message.date).toISOString(),
    unread: true,
    starred: false,
    messageCount: 1,
    hasAttachments: false,
  };
  await Promise.all(
    owners.map((owner) => notifyNewThreads({ id: owner.id, email: owner.email, userId: owner.user_id }, [thread])),
  );
}

/**
 * Looks at the inbox of each account whose owner has a device with
 * notifications on, and sends a notification for each new unread thread.
 * Hosted mail does not need this, because its webhook sends the notification.
 */
export async function checkNewMail() {
  const users = await query<{ user_id: string }>("SELECT DISTINCT user_id FROM push_subscriptions");
  const accounts = (await Promise.all(users.map((u) => listAccounts(u.user_id))))
    .flat()
    .filter((a) => a.status === "active" && a.provider !== "hosted" && a.provider !== "demo");
  const checks = new Map(
    (
      await query<{ account_id: string; newest: string }>(
        "SELECT account_id, newest FROM inbox_checks WHERE account_id = ANY($1)",
        [accounts.map((a) => a.id)],
      )
    ).map((row) => [row.account_id, new Date(row.newest).getTime()]),
  );

  const results = await mapLimit(accounts, 8, async (account) => {
    try {
      const { threads } = await providerFor(account).listThreads({ folder: "inbox", limit: 10 });
      const last = checks.get(account.id);
      // The first check of an account only records the newest date. An empty inbox records the time now.
      const newest = Math.max(0, ...threads.map((t) => Date.parse(t.date))) || Date.now();
      const fresh = last == null ? [] : threads.filter((t) => t.unread && Date.parse(t.date) > last);
      if (last == null || newest > last) {
        await query(
          `INSERT INTO inbox_checks (account_id, newest, checked_at) VALUES ($1, $2, now())
           ON CONFLICT (account_id) DO UPDATE SET newest = $2, checked_at = now()`,
          [account.id, new Date(newest).toISOString()],
        );
      }
      await notifyNewThreads(account, fresh);
      return fresh.length;
    } catch (error) {
      console.error("Mail check failed", account.id, error);
      return 0;
    }
  });
  return { accounts: accounts.length, notified: results.reduce((sum, n) => sum + n, 0) };
}
