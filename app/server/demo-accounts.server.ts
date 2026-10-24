import { createUser, findAccountOwner, insertAccount } from "./accounts.server";
import { randomToken } from "./crypto.server";
import { DEMO_PERSONAS } from "./providers/demo.server";

/** The demo account for a persona, with an address that no other account has. */
export async function demoAccount(persona: number) {
  const { label, name, domain, email, look } = DEMO_PERSONAS[persona];
  const id = randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "");
  return {
    provider: "demo" as const,
    email: email ? await freeEmail(email) : `alex.${label}.${id}@${domain}`,
    name,
    credentials: { persona, look },
  };
}

/** A connection with an existing address refreshes that account. Thus a second
    account of the same persona gets a number: alex@northwind.io, then alex2@northwind.io. */
async function freeEmail(email: string) {
  const [local, domain] = email.split("@");
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? email : `${local}${n}@${domain}`;
    if (!(await findAccountOwner("demo", candidate))) return candidate;
  }
}

// The work, Gmail, and Outlook personas. They look like real accounts.
const WORKSPACE_PERSONAS = [0, 1, 3];

/**
 * A new workspace with sample mail, for a visitor of the public demo or a
 * directory reviewer. Each visitor gets a workspace, so visitors never see
 * each other's mail. All workspaces have the same addresses, such as
 * alex@northwind.io. Demo accounts send nothing: a sent message only goes
 * to their Sent folder. The daily cron job deletes the workspace after a week.
 */
export async function createDemoWorkspace() {
  const userId = await createUser({ demo: true });
  for (const persona of WORKSPACE_PERSONAS) {
    const { name, email, look } = DEMO_PERSONAS[persona];
    await insertAccount({ userId, provider: "demo", email: email!, name, credentials: { persona, look } });
  }
  return userId;
}

/** True on demo.samayo.me. There, the home page and the sign-in page open the demo. */
export function isDemoHost(request: Request) {
  return new URL(request.url).hostname.startsWith("demo.");
}
