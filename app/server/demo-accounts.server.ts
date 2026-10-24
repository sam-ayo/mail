import { createUser, findAccountOwner, upsertAccount } from "./accounts.server";
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
const REVIEW_PERSONAS = [0, 1, 3];

/**
 * A new workspace with sample mail for a directory reviewer. Each sign-in gets
 * its own workspace, so reviewers never see each other's accounts. Demo
 * accounts send nothing: a sent message only goes to their Sent folder.
 */
export async function createReviewWorkspace() {
  const userId = await createUser();
  for (const persona of REVIEW_PERSONAS) {
    await upsertAccount({ userId, ...(await demoAccount(persona)) });
  }
  return userId;
}
