import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env.server", () => ({
  env: { isProduction: false, sessionSecret: "test-secret", cronSecret: "" },
}));
vi.mock("./providers/imap.server", () => ({ closeImapConnection: vi.fn() }));
vi.mock("./oauth/microsoft.server", () => ({
  isConsumerMicrosoftSubject: () => false,
  microsoftStoredSubject: vi.fn(),
}));
vi.mock("./accounts.server", () => ({
  createUser: vi.fn(),
  findAccountWorkspaces: vi.fn(),
  findSignIn: vi.fn(),
  getAccountById: vi.fn(),
  insertSignIn: vi.fn(),
  isDemoUser: vi.fn(),
  resolveUser: vi.fn(),
  resolveUserAccounts: vi.fn(),
  sessionVersion: vi.fn(),
  setAccountSubject: vi.fn(),
  updateCredentials: vi.fn(),
  upsertAccount: vi.fn(),
}));

const accounts = await import("./accounts.server");
const { connectAccount, sharedMailboxError, signInWithIdentity } = await import("./auth.server");
const { getSession, sessionStorage } = await import("./session.server");

const mocked = vi.mocked(accounts);
const newUser = "00000000-0000-4000-8000-000000000001";
const identity = { provider: "google" as const, email: "support@acme.com", subject: "sub-support" };

function workspace(userId: string, canSignIn: boolean) {
  return { accountId: `account-${userId}`, userId, canSignIn, subject: identity.subject };
}

async function newSession() {
  return getSession(new Request("https://mail.test/"));
}

/** The flash error that the response puts in the session cookie. */
async function flashError(response: Response) {
  const session = await sessionStorage.getSession(response.headers.get("Set-Cookie"));
  return session.get("error");
}

beforeEach(() => {
  vi.resetAllMocks();
  // resolveUser gives back the id it gets, as for a workspace that exists.
  mocked.resolveUser.mockImplementation(async (id) => id);
  mocked.sessionVersion.mockResolvedValue(0);
  mocked.createUser.mockResolvedValue(newUser);
  mocked.findSignIn.mockResolvedValue(undefined);
  mocked.findAccountWorkspaces.mockResolvedValue([]);
});

describe("signInWithIdentity", () => {
  it("refuses an address that is a shared mailbox in a workspace", async () => {
    mocked.findAccountWorkspaces.mockResolvedValue([workspace("alice", false)]);
    const response = await signInWithIdentity(await newSession(), identity);
    expect(response.headers.get("Location")).toBe("/welcome");
    expect(await flashError(response)).toBe(sharedMailboxError(identity.email));
    expect(mocked.createUser).not.toHaveBeenCalled();
    expect(mocked.insertSignIn).not.toHaveBeenCalled();
  });

  it("refuses a shared mailbox that is in many workspaces", async () => {
    mocked.findAccountWorkspaces.mockResolvedValue([workspace("alice", false), workspace("bob", false)]);
    const response = await signInWithIdentity(await newSession(), identity);
    expect(response.headers.get("Location")).toBe("/welcome");
    expect(mocked.createUser).not.toHaveBeenCalled();
  });

  it("opens the workspace of an address that logged in before", async () => {
    mocked.findSignIn.mockResolvedValue("carol");
    mocked.findAccountWorkspaces.mockResolvedValue([workspace("alice", false)]);
    const response = await signInWithIdentity(await newSession(), identity);
    expect(response.headers.get("Location")).toBe("/mail/all/inbox");
    expect(mocked.createUser).not.toHaveBeenCalled();
  });

  it("opens the workspace of a login mailbox from before sign-ins", async () => {
    mocked.findAccountWorkspaces.mockResolvedValue([workspace("alice", false), workspace("dave", true)]);
    const response = await signInWithIdentity(await newSession(), identity);
    expect(response.headers.get("Location")).toBe("/mail/all/inbox");
    const session = await sessionStorage.getSession(response.headers.get("Set-Cookie"));
    expect(session.get("userId")).toBe("dave");
  });

  it("gives a new address a new workspace", async () => {
    const response = await signInWithIdentity(await newSession(), identity);
    expect(response.headers.get("Location")).toBe("/accounts/add");
    expect(mocked.insertSignIn).toHaveBeenCalledWith({ userId: newUser, ...identity });
  });
});

describe("connectAccount", () => {
  const input = { ...identity, name: "Support", credentials: {} as never };

  it("refuses a shared mailbox in a browser with no workspace", async () => {
    mocked.findAccountWorkspaces.mockResolvedValue([workspace("alice", false)]);
    const response = await connectAccount(await newSession(), input);
    expect(response.headers.get("Location")).toBe("/welcome");
    expect(await flashError(response)).toBe(sharedMailboxError(identity.email));
    expect(mocked.upsertAccount).not.toHaveBeenCalled();
  });

  it("adds a shared mailbox to the workspace of a logged-in person", async () => {
    mocked.findAccountWorkspaces.mockResolvedValue([workspace("alice", false)]);
    mocked.isDemoUser.mockResolvedValue(false);
    const session = await newSession();
    session.set("userId", "bob");
    session.set("version", 0);
    const response = await connectAccount(session, input);
    expect(response.headers.get("Location")).toBe("/mail/all/inbox");
    expect(mocked.upsertAccount).toHaveBeenCalledWith(expect.objectContaining({ userId: "bob", canSignIn: false }));
  });
});
